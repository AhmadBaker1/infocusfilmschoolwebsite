// Blog articles: queries for the staff area and the public blog pages, the
// card shape PostCard.astro renders, and the heading extractor for the
// article contents list. Bodies are sanitised HTML with real <h2>/<h3>;
// dates are ISO UTC in D1 and Mountain Time on screen. Server-only.
import { all, newId, now, one } from './db';
import { escapeHtml, slugify } from './http';
import { TZ, fmtDate } from '../format';

export type Category = 'howto' | 'industry' | 'success';
export type PostStatus = 'draft' | 'published';
export type AdminTab = 'published' | 'drafts';

export const CATEGORIES: Category[] = ['howto', 'industry', 'success'];
export const CATEGORY_LABELS: Record<Category, string> = {
  howto: 'Guides + How-Tos',
  industry: 'Understanding the Industry',
  success: 'Student Success',
};
export const STATUSES: PostStatus[] = ['draft', 'published'];
export const TABS: AdminTab[] = ['published', 'drafts'];
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface Post {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: Category;
  author: string;
  cover_key: string | null;
  cover_url: string | null;
  cover_alt: string;
  body_html: string;
  status: PostStatus;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Everything the form edits. cover_key is set separately after the upload. */
export interface PostInput {
  title: string;
  slug: string;
  excerpt: string;
  category: Category;
  author: string;
  cover_alt: string;
  body_html: string;
  status: PostStatus;
  published_at: string | null;
}

/** What PostCard.astro renders. Same shape the Markdown-era toCard() produced. */
export interface PostCard {
  slug: string;
  href: string;
  title: string;
  description: string;
  category: Category;
  categoryLabel: string;
  author?: string;
  date: Date;
  /* YYYY-MM-DD in Mountain Time, for <time datetime>. */
  dateIso: string;
  dateText: string;
  minutes: number;
  image?: string;
  imageAlt: string;
}

const WORDS_PER_MINUTE = 230;

// ---- Queries ----

function tabWhere(tab: AdminTab): { sql: string; order: string } {
  return tab === 'published'
    ? { sql: `status = 'published'`, order: 'published_at DESC, updated_at DESC' }
    : { sql: `status = 'draft'`, order: 'updated_at DESC' };
}

function searchWhere(q: string): { sql: string; binds: unknown[] } {
  const s = q.trim();
  if (!s) return { sql: '', binds: [] };
  const like = `%${s.replace(/[%_]/g, '')}%`;
  return { sql: ' AND (title LIKE ? OR slug LIKE ? OR author LIKE ?)', binds: [like, like, like] };
}

export async function listAdmin(d1: D1Database, opts: { tab: AdminTab; q?: string }): Promise<Post[]> {
  const t = tabWhere(opts.tab);
  const s = searchWhere(opts.q ?? '');
  return all<Post>(d1.prepare(`SELECT * FROM posts WHERE ${t.sql}${s.sql} ORDER BY ${t.order}`).bind(...s.binds));
}

/** Per-tab totals for the tab strip; respects the search box so counts match what is listed. */
export async function tabCounts(d1: D1Database, q = ''): Promise<Record<AdminTab, number>> {
  const s = searchWhere(q);
  const out = { published: 0, drafts: 0 };
  for (const tab of TABS) {
    const t = tabWhere(tab);
    const r = await d1.prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${t.sql}${s.sql}`).bind(...s.binds).first<{ n: number }>();
    out[tab] = r?.n ?? 0;
  }
  return out;
}

// Public: published, and the publish date has passed (a future date schedules the article).
const LIVE = `status = 'published' AND published_at IS NOT NULL AND published_at <= ?`;

export async function listPublished(d1: D1Database, opts: { category?: Category; limit?: number } = {}): Promise<Post[]> {
  const binds: unknown[] = [now()];
  let sql = `SELECT * FROM posts WHERE ${LIVE}`;
  if (opts.category) {
    sql += ' AND category = ?';
    binds.push(opts.category);
  }
  sql += ' ORDER BY published_at DESC';
  if (opts.limit) {
    sql += ' LIMIT ?';
    binds.push(opts.limit);
  }
  return all<Post>(d1.prepare(sql).bind(...binds));
}

export async function getBySlug(d1: D1Database, slug: string, opts: { publishedOnly?: boolean } = {}): Promise<Post | null> {
  if (opts.publishedOnly) return one<Post>(d1.prepare(`SELECT * FROM posts WHERE slug = ? AND ${LIVE}`).bind(slug, now()));
  return one<Post>(d1.prepare('SELECT * FROM posts WHERE slug = ?').bind(slug));
}

export async function getById(d1: D1Database, id: string): Promise<Post | null> {
  return one<Post>(d1.prepare('SELECT * FROM posts WHERE id = ?').bind(id));
}

/** `base` (or its slugified form) if free, else base-2, base-3, ... */
export async function uniqueSlug(d1: D1Database, base: string, excludeId: string | null = null): Promise<string> {
  const root = slugify(base) || 'article';
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? root : `${root.slice(0, 76)}-${n}`;
    const clash = await d1
      .prepare('SELECT id FROM posts WHERE slug = ? AND id != ?')
      .bind(candidate, excludeId ?? '')
      .first();
    if (!clash) return candidate;
  }
  return `${root.slice(0, 60)}-${newId().slice(0, 8)}`;
}

export async function create(d1: D1Database, input: PostInput, createdBy: string | null): Promise<Post> {
  const id = newId();
  const ts = now();
  // A published article always has a public date.
  const published_at = input.published_at ?? (input.status === 'published' ? ts : null);
  await d1
    .prepare(
      `INSERT INTO posts (id, slug, title, excerpt, category, author, cover_alt, body_html, status, published_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.slug, input.title, input.excerpt, input.category, input.author, input.cover_alt, input.body_html, input.status, published_at, createdBy, ts, ts)
    .run();
  return (await getById(d1, id))!;
}

export async function update(d1: D1Database, id: string, input: PostInput): Promise<void> {
  const ts = now();
  await d1
    .prepare(
      `UPDATE posts SET slug = ?, title = ?, excerpt = ?, category = ?, author = ?, cover_alt = ?, body_html = ?, status = ?,
       published_at = CASE WHEN ? IS NOT NULL THEN ? WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END,
       updated_at = ? WHERE id = ?`
    )
    .bind(
      input.slug,
      input.title,
      input.excerpt,
      input.category,
      input.author,
      input.cover_alt,
      input.body_html,
      input.status,
      input.published_at,
      input.published_at,
      input.status,
      ts,
      ts,
      id
    )
    .run();
}

/** Publishing fills in the date if the article never had one; unpublishing keeps it. */
export async function setStatus(d1: D1Database, id: string, status: PostStatus): Promise<void> {
  const ts = now();
  if (status === 'published') {
    await d1.prepare(`UPDATE posts SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?`).bind(ts, ts, id).run();
  } else {
    await d1.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?').bind(status, ts, id).run();
  }
}

/** Point the article at an uploaded cover (or clear it; `null` also drops a legacy cover_url). */
export async function setCover(d1: D1Database, id: string, key: string | null, alt?: string | null): Promise<void> {
  if (key === null) {
    await d1
      .prepare('UPDATE posts SET cover_key = NULL, cover_url = NULL, cover_alt = ?, updated_at = ? WHERE id = ?')
      .bind(alt ?? '', now(), id)
      .run();
  } else if (alt === undefined) {
    await d1.prepare('UPDATE posts SET cover_key = ?, updated_at = ? WHERE id = ?').bind(key, now(), id).run();
  } else {
    await d1.prepare('UPDATE posts SET cover_key = ?, cover_alt = ?, updated_at = ? WHERE id = ?').bind(key, alt ?? '', now(), id).run();
  }
}

/**
 * Copy an article as a new draft. Uploaded covers live under blog/<id>/, so
 * the caller copies the R2 object to the new id via `copyImage` (returns the
 * new key, or null to leave the copy without one).
 */
export async function duplicate(
  d1: D1Database,
  source: Post,
  opts: { createdBy: string | null; copyImage?: (srcKey: string, newId: string) => Promise<string | null> }
): Promise<Post> {
  const id = newId();
  const ts = now();
  const title = `Copy of ${source.title}`.slice(0, 160);
  const slug = await uniqueSlug(d1, `${source.slug}-copy`);
  const coverKey = source.cover_key && opts.copyImage ? await opts.copyImage(source.cover_key, id) : null;
  await d1
    .prepare(
      `INSERT INTO posts (id, slug, title, excerpt, category, author, cover_key, cover_url, cover_alt, body_html, status, published_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?, ?)`
    )
    .bind(id, slug, title, source.excerpt, source.category, source.author, coverKey, source.cover_url, source.cover_alt, source.body_html, opts.createdBy, ts, ts)
    .run();
  return (await getById(d1, id))!;
}

export async function remove(d1: D1Database, id: string): Promise<void> {
  await d1.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
}

// ---- Presentation ----

/** The cover as a URL: an upload under blog/ or the legacy site path. */
export const coverUrl = (post: Pick<Post, 'cover_key' | 'cover_url'>) => (post.cover_key ? `/files/${post.cover_key}` : post.cover_url);

const dateIsoMT = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** First photo in the article that is not an animated GIF. */
function firstImage(html: string): { src: string; alt: string } | null {
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    const src = /\ssrc\s*=\s*"([^"]+)"/.exec(m[0])?.[1];
    if (!src || src.toLowerCase().endsWith('.gif')) continue;
    return { src, alt: /\salt\s*=\s*"([^"]*)"/.exec(m[0])?.[1] ?? '' };
  }
  return null;
}

/**
 * Card data for PostCard.astro. The thumbnail is an uploaded cover if there
 * is one, else the first photo in the article. The legacy cover_url images
 * are title cards (one misspelt), so like before they only serve as the
 * share image, never as a thumbnail.
 */
export function toCard(post: Post): PostCard {
  const when = post.published_at ?? post.created_at;
  const img = post.cover_key ? { src: `/files/${post.cover_key}`, alt: post.cover_alt } : firstImage(post.body_html);
  return {
    slug: post.slug,
    href: `/${post.slug}/`,
    title: post.title,
    description: post.excerpt,
    category: post.category,
    categoryLabel: CATEGORY_LABELS[post.category],
    author: post.author || undefined,
    date: new Date(when),
    dateIso: dateIsoMT(when),
    dateText: fmtDate(when, { month: 'long' }),
    minutes: Math.max(1, Math.round(post.body_html.split(/\s+/).length / WORDS_PER_MINUTE)),
    image: img?.src,
    imageAlt: img?.alt ?? '',
  };
}

// ---- Photos and video embeds in the editor ----
//
// The rich editor only knows text, headings, lists and links; it drops
// <img>, <figure> and the YouTube <div class="embed"> blocks the original
// articles carry. So the form shows each block as a plain marker line
// ("[[Photo 3: caption]]") that staff can move or delete, and on save the
// original blocks (from the stored body, never from the browser) go back
// where their markers ended up.

const MEDIA_RE = /<figure\b[\s\S]*?<\/figure>|<div class="embed"[\s\S]*?<\/div>|<img\b[^>]*>/gi;
const MARKER_RE = /\[\[(?:Photo|Video) (\d+)(?::[^\]]*)?\]\]/g;

const attr = (tag: string, name: string) => decode(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? '');

/** Does the body carry blocks the editor cannot show? */
export const hasMedia = (body_html: string) => new RegExp(MEDIA_RE.source, 'i').test(body_html);

/** Body for the editor: media blocks become numbered marker lines. */
export function toEditable(body_html: string): string {
  let n = 0;
  return body_html.replace(MEDIA_RE, (block) => {
    n++;
    const video = /data-yt=/i.test(block);
    const label = video
      ? attr(block, 'data-title') || 'YouTube'
      : attr(block, 'alt') || (attr(block, 'src').split('/').pop() ?? '');
    return `<p>[[${video ? 'Video' : 'Photo'} ${n}${label ? `: ${escapeHtml(label.replace(/[\[\]]/g, ''))}` : ''}]]</p>`;
  });
}

/**
 * Saved body: marker lines become the media blocks they stand for, taken
 * from `stored` (the body before this edit). A deleted marker drops the
 * block; a marker that lost its own line is removed.
 */
export function restoreMedia(html: string, stored: string): string {
  const blocks = stored.match(MEDIA_RE) ?? [];
  const line = new RegExp(`<p>\\s*(${MARKER_RE.source})\\s*</p>`, 'g');
  return html
    .replace(line, (_, __, n: string) => blocks[Number(n) - 1] ?? '')
    .replace(MARKER_RE, '')
    .replace(/<(p|li)>\s*<\/\1>/g, '');
}

export interface Heading {
  depth: 2 | 3;
  slug: string;
  text: string;
}

const decode = (s: string) =>
  s
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;|&#x22;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/**
 * Pull the <h2>/<h3> headings out of an article body for the contents list,
 * and give each one a unique id (slugified text) so the list can link to it.
 * Returns the body with the ids in place.
 */
export function headings(body_html: string): { html: string; headings: Heading[] } {
  const found: Heading[] = [];
  const used = new Set<string>();
  const html = body_html.replace(/<(h[23])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_, tag: string, inner: string) => {
    const text = decode(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const base = slugify(text) || 'section';
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    const depth = tag.toLowerCase() === 'h2' ? 2 : 3;
    found.push({ depth, slug, text });
    return `<${tag.toLowerCase()} id="${escapeHtml(slug)}">${inner}</${tag.toLowerCase()}>`;
  });
  return { html, headings: found };
}
