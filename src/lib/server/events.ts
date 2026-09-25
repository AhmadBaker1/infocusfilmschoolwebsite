// Events: queries for the staff area and the public /events pages, plus the
// shared "when" labels. Times are ISO UTC in D1; labels are Mountain Time.
// Server-only.
import { all, newId, now, one } from './db';
import { slugify } from './http';
import { TZ_LABEL, fmtDate, fmtTime } from '../format';

export type EventMode = 'in-person' | 'online' | 'hybrid';
export type EventStatus = 'draft' | 'published' | 'archived';
export type AdminTab = 'upcoming' | 'past' | 'drafts' | 'archived';

export const MODES: EventMode[] = ['in-person', 'online', 'hybrid'];
export const MODE_LABELS: Record<EventMode, string> = { 'in-person': 'In person', online: 'Online', hybrid: 'Hybrid' };
export const STATUSES: EventStatus[] = ['draft', 'published', 'archived'];
export const TABS: AdminTab[] = ['upcoming', 'past', 'drafts', 'archived'];
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface Event {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body_md: string;
  body_html: string;
  starts_at: string;
  ends_at: string | null;
  timezone: string;
  location: string;
  mode: EventMode;
  register_url: string | null;
  image_key: string | null;
  image_alt: string | null;
  status: EventStatus;
  featured: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Everything a staff member can edit. image_key is set separately after the upload. */
export interface EventInput {
  title: string;
  slug: string;
  summary: string;
  body_md: string;
  body_html: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  mode: EventMode;
  register_url: string | null;
  image_alt: string;
  status: EventStatus;
  featured: boolean;
}

// An event is "upcoming" until it has ended (or started, if it has no end).
const ENDED = 'COALESCE(ends_at, starts_at) < ?';
const NOT_ENDED = 'COALESCE(ends_at, starts_at) >= ?';

function tabWhere(tab: AdminTab, nowIso: string): { sql: string; binds: unknown[]; order: string } {
  switch (tab) {
    case 'upcoming':
      return { sql: `status = 'published' AND ${NOT_ENDED}`, binds: [nowIso], order: 'starts_at ASC' };
    case 'past':
      return { sql: `status = 'published' AND ${ENDED}`, binds: [nowIso], order: 'starts_at DESC' };
    case 'drafts':
      return { sql: `status = 'draft'`, binds: [], order: 'updated_at DESC' };
    case 'archived':
      return { sql: `status = 'archived'`, binds: [], order: 'starts_at DESC' };
  }
}

function searchWhere(q: string): { sql: string; binds: unknown[] } {
  const s = q.trim();
  if (!s) return { sql: '', binds: [] };
  const like = `%${s.replace(/[%_]/g, '')}%`;
  return { sql: ' AND (title LIKE ? OR slug LIKE ? OR location LIKE ?)', binds: [like, like, like] };
}

export async function listAdmin(d1: D1Database, opts: { tab: AdminTab; q?: string }): Promise<Event[]> {
  const t = tabWhere(opts.tab, now());
  const s = searchWhere(opts.q ?? '');
  return all<Event>(
    d1.prepare(`SELECT * FROM events WHERE ${t.sql}${s.sql} ORDER BY ${t.order}`).bind(...t.binds, ...s.binds)
  );
}

/** Per-tab totals for the tab strip; respects the search box so counts match what is listed. */
export async function tabCounts(d1: D1Database, q = ''): Promise<Record<AdminTab, number>> {
  const nowIso = now();
  const s = searchWhere(q);
  const out = { upcoming: 0, past: 0, drafts: 0, archived: 0 };
  for (const tab of TABS) {
    const t = tabWhere(tab, nowIso);
    const r = await d1
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE ${t.sql}${s.sql}`)
      .bind(...t.binds, ...s.binds)
      .first<{ n: number }>();
    out[tab] = r?.n ?? 0;
  }
  return out;
}

export async function listPublicUpcoming(d1: D1Database): Promise<Event[]> {
  return all<Event>(d1.prepare(`SELECT * FROM events WHERE status = 'published' AND ${NOT_ENDED} ORDER BY starts_at ASC`).bind(now()));
}

export async function listPublicPast(d1: D1Database, limit = 6): Promise<Event[]> {
  return all<Event>(
    d1.prepare(`SELECT * FROM events WHERE status = 'published' AND ${ENDED} ORDER BY starts_at DESC LIMIT ?`).bind(now(), limit)
  );
}

export async function getBySlug(d1: D1Database, slug: string, opts: { publishedOnly?: boolean } = {}): Promise<Event | null> {
  const sql = opts.publishedOnly ? `SELECT * FROM events WHERE slug = ? AND status = 'published'` : 'SELECT * FROM events WHERE slug = ?';
  return one<Event>(d1.prepare(sql).bind(slug));
}

export async function getById(d1: D1Database, id: string): Promise<Event | null> {
  return one<Event>(d1.prepare('SELECT * FROM events WHERE id = ?').bind(id));
}

/** `base` (or its slugified form) if free, else base-2, base-3, ... */
export async function uniqueSlug(d1: D1Database, base: string, excludeId: string | null = null): Promise<string> {
  const root = slugify(base) || 'event';
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? root : `${root.slice(0, 76)}-${n}`;
    const clash = await d1
      .prepare('SELECT id FROM events WHERE slug = ? AND id != ?')
      .bind(candidate, excludeId ?? '')
      .first();
    if (!clash) return candidate;
  }
  return `${root.slice(0, 60)}-${newId().slice(0, 8)}`;
}

export async function create(d1: D1Database, input: EventInput, createdBy: string | null): Promise<Event> {
  const id = newId();
  const ts = now();
  await d1
    .prepare(
      `INSERT INTO events (id, slug, title, summary, body_md, body_html, starts_at, ends_at, location, mode, register_url, image_alt, status, featured, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.slug,
      input.title,
      input.summary,
      input.body_md,
      input.body_html,
      input.starts_at,
      input.ends_at,
      input.location,
      input.mode,
      input.register_url,
      input.image_alt || null,
      input.status,
      input.featured ? 1 : 0,
      createdBy,
      ts,
      ts
    )
    .run();
  return (await getById(d1, id))!;
}

export async function update(d1: D1Database, id: string, input: EventInput): Promise<void> {
  await d1
    .prepare(
      `UPDATE events SET slug = ?, title = ?, summary = ?, body_md = ?, body_html = ?, starts_at = ?, ends_at = ?, location = ?, mode = ?,
       register_url = ?, image_alt = ?, status = ?, featured = ?, updated_at = ? WHERE id = ?`
    )
    .bind(
      input.slug,
      input.title,
      input.summary,
      input.body_md,
      input.body_html,
      input.starts_at,
      input.ends_at,
      input.location,
      input.mode,
      input.register_url,
      input.image_alt || null,
      input.status,
      input.featured ? 1 : 0,
      now(),
      id
    )
    .run();
}

export async function setStatus(d1: D1Database, id: string, status: EventStatus): Promise<void> {
  await d1.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), id).run();
}

export async function setImage(d1: D1Database, id: string, key: string | null, alt?: string | null): Promise<void> {
  if (alt === undefined) {
    await d1.prepare('UPDATE events SET image_key = ?, updated_at = ? WHERE id = ?').bind(key, now(), id).run();
  } else {
    await d1.prepare('UPDATE events SET image_key = ?, image_alt = ?, updated_at = ? WHERE id = ?').bind(key, alt || null, now(), id).run();
  }
}

/**
 * Copy an event as a new draft. The image lives under events/<id>/, so the
 * caller copies the R2 object to the new id via `copyImage` (returns the
 * new key, or null to leave the copy without an image).
 */
export async function duplicate(
  d1: D1Database,
  source: Event,
  opts: { createdBy: string | null; copyImage?: (srcKey: string, newId: string) => Promise<string | null> }
): Promise<Event> {
  const id = newId();
  const ts = now();
  const title = `Copy of ${source.title}`.slice(0, 160);
  const slug = await uniqueSlug(d1, `${source.slug}-copy`);
  const imageKey = source.image_key && opts.copyImage ? await opts.copyImage(source.image_key, id) : null;
  await d1
    .prepare(
      `INSERT INTO events (id, slug, title, summary, body_md, body_html, starts_at, ends_at, timezone, location, mode, register_url, image_key, image_alt, status, featured, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?)`
    )
    .bind(
      id,
      slug,
      title,
      source.summary,
      source.body_md,
      source.body_html,
      source.starts_at,
      source.ends_at,
      source.timezone,
      source.location,
      source.mode,
      source.register_url,
      imageKey,
      imageKey ? source.image_alt : null,
      opts.createdBy,
      ts,
      ts
    )
    .run();
  return (await getById(d1, id))!;
}

export async function remove(d1: D1Database, id: string): Promise<void> {
  await d1.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
}

// ---- Labels ----

const strip = (s: string) => s.replace(/\./g, '');

/** "Sat, Oct 10, 2026, 6:30 pm MT" */
export function whenLabel(ev: Pick<Event, 'starts_at'>): string {
  return `${strip(fmtDate(ev.starts_at, { weekday: 'short' }))}, ${fmtTime(ev.starts_at)} ${TZ_LABEL}`;
}

/** Date and time range, e.g. "Sat, Oct 10, 2026" + "6:30 to 8:30 pm MT" or "Oct 10, 6:30 pm to Oct 11, 4:00 pm MT". */
export function whenParts(ev: Pick<Event, 'starts_at' | 'ends_at'>): { date: string; time: string } {
  const date = strip(fmtDate(ev.starts_at, { weekday: 'short' }));
  const start = fmtTime(ev.starts_at);
  if (!ev.ends_at) return { date, time: `${start} ${TZ_LABEL}` };
  const sameDay = fmtDate(ev.starts_at) === fmtDate(ev.ends_at);
  if (sameDay) return { date, time: `${start} to ${fmtTime(ev.ends_at)} ${TZ_LABEL}` };
  return {
    date: `${date} to ${strip(fmtDate(ev.ends_at, { weekday: 'short' }))}`,
    time: `${start} to ${strip(fmtDate(ev.ends_at, { year: undefined }))}, ${fmtTime(ev.ends_at)} ${TZ_LABEL}`,
  };
}

/** Month + day for the calendar block on cards. */
export function dateBlock(iso: string): { month: string; day: string; weekday: string } {
  return {
    month: strip(fmtDate(iso, { month: 'short', day: undefined, year: undefined })),
    day: fmtDate(iso, { month: undefined, year: undefined, day: 'numeric' }),
    weekday: strip(fmtDate(iso, { weekday: 'short', month: undefined, day: undefined, year: undefined })),
  };
}

export const imageUrl = (ev: Pick<Event, 'image_key'>) => (ev.image_key ? `/files/${ev.image_key}` : null);
