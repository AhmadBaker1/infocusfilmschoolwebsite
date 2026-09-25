// One-off: turns src/data/jobs.json into migrations/0002_seed_jobs.sql so the
// live postings exist in D1 from day one. Re-run if jobs.json changes before
// the first deploy; after that, edit jobs in the staff area instead.
import { readFile, writeFile } from 'node:fs/promises';

const jobs = JSON.parse(await readFile(new URL('../src/data/jobs.json', import.meta.url), 'utf8'));
const q = (s) => `'${String(s ?? '').replace(/'/g, "''")}'`;
const ts = new Date().toISOString();

const rows = jobs.map(
  (j, i) =>
    `INSERT INTO jobs (id, title, dept, location, type, pay, body_md, html, status, sort, created_at, updated_at)\n` +
    `VALUES (${q(j.id)}, ${q(j.title)}, ${q(j.dept)}, ${q(j.location)}, ${q(j.type)}, ${q(j.pay)}, '', ${q(j.html)}, 'open', ${i}, ${q(ts)}, ${q(ts)});`
);

const sql = `-- Seeded from src/data/jobs.json by scripts/seed-jobs.mjs.\n${rows.join('\n\n')}\n`;
await writeFile(new URL('../migrations/0002_seed_jobs.sql', import.meta.url), sql, 'utf8');
console.log(`Wrote ${jobs.length} jobs to migrations/0002_seed_jobs.sql`);
