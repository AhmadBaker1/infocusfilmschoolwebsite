// One-off: turns the original blog Markdown files into
// migrations/0004_seed_posts.sql so the 15 articles exist in D1 from day one.
// It reads src/content/blog/*.md (kept in git history; the files were removed
// from the working tree once the migration was generated), renders each body
// to HTML with marked (real <h2>/<h3>, inline <figure>/<img> and the YouTube
// embed <div>s pass through untouched) and writes one INSERT per post:
// published, published_at from the frontmatter date (midnight Mountain Time),
// excerpt from the description, cover_url from the cover image path.
//
//   node scripts/seed-posts.mjs [path/to/markdown/dir]
//
// After that, edit articles in the staff area (/admin/blog), not here.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const dir = process.argv[2] ?? fileURLToPath(new URL('../src/content/blog', import.meta.url));
const out = new URL('../migrations/0004_seed_posts.sql', import.meta.url);
const TZ = 'America/Edmonton';

const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

/** Minimal frontmatter reader: `key: value` lines, quoted or bare. */
function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('No frontmatter');
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^".*"$/.test(v)) v = JSON.parse(v);
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

/** Midnight on a YYYY-MM-DD in Mountain Time, as ISO UTC. */
function midnightMT(ymd) {
  const [y, mo, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(guess));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return new Date(guess - (local - guess)).toISOString();
}

const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
const rows = [];
for (const file of files) {
  const slug = file.replace(/\.md$/, '');
  const { data, body } = parseFrontmatter(await readFile(join(dir, file), 'utf8'));
  if (!['howto', 'industry', 'success'].includes(data.category)) throw new Error(`${file}: bad category ${data.category}`);
  const html = marked.parse(body.trim(), { gfm: true, async: false }).trim();
  const published = midnightMT(data.date);
  const updated = data.updated ? midnightMT(data.updated) : published;
  rows.push(
    `INSERT INTO posts (id, slug, title, excerpt, category, author, cover_key, cover_url, cover_alt, body_html, status, published_at, created_by, created_at, updated_at)\n` +
      `VALUES (${q(crypto.randomUUID())}, ${q(slug)}, ${q(data.title)}, ${q(data.description ?? '')}, ${q(data.category)}, ${q(data.author ?? '')}, NULL, ${q(data.cover || null)}, ${q(data.coverAlt ?? '')}, ${q(html)}, 'published', ${q(published)}, NULL, ${q(published)}, ${q(updated)});`
  );
  console.log(`${slug}: ${html.length} chars, ${data.category}, ${published}`);
}

const sql = `-- Seeded from the original src/content/blog Markdown files by scripts/seed-posts.mjs.\n${rows.join('\n\n')}\n`;
await writeFile(out, sql, 'utf8');
console.log(`Wrote ${rows.length} posts to migrations/0004_seed_posts.sql`);
