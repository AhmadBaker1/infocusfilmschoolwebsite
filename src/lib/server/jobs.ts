// Job postings in D1. Server-only. Public pages use listOpen/getOpenById;
// the staff area uses the rest. Slugs (ids) are public URLs, so they are
// fixed once created; duplicating makes a new draft with a fresh slug.
import type { Job } from '../jobs';
import { DEPTS } from '../jobs';
import { all, count, now, one } from './db';
import { slugify } from './http';
import { mdToHtml } from './markdown';

export type JobStatus = 'draft' | 'open' | 'closed';
export const STATUSES: JobStatus[] = ['draft', 'open', 'closed'];

export interface JobRow extends Job {
  status: JobStatus;
  body_md: string;
  sort: number;
  closes_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobListRow extends JobRow {
  applicants: number;
}

export interface JobInput {
  title: string;
  dept: string;
  location: string;
  type: string;
  pay: string;
  body_md: string;
  /* Sanitized HTML from the rich editor. Older callers pass markdown in body_md instead. */
  html?: string;
  status: JobStatus;
  sort: number;
  closes_at: string | null;
}

const bodyHtml = (input: JobInput) => input.html ?? mdToHtml(input.body_md);

const COLS = 'id, title, dept, location, type, pay, body_md, html, status, sort, closes_at, created_by, created_at, updated_at';

export const isStatus = (s: string): s is JobStatus => (STATUSES as string[]).includes(s);
export const isDept = (s: string): boolean => Object.prototype.hasOwnProperty.call(DEPTS, s);

/** Open and not past its closing date. */
export const isAccepting = (j: Pick<JobRow, 'status' | 'closes_at'>): boolean =>
  j.status === 'open' && (!j.closes_at || j.closes_at > now());

export async function listAdmin(d1: D1Database, opts: { tab?: JobStatus; q?: string } = {}): Promise<JobListRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.tab) {
    where.push('j.status = ?');
    binds.push(opts.tab);
  }
  if (opts.q) {
    where.push('(j.title LIKE ? OR j.id LIKE ? OR j.location LIKE ?)');
    const like = `%${opts.q.replace(/[%_]/g, '')}%`;
    binds.push(like, like, like);
  }
  return all<JobListRow>(
    d1
      .prepare(
        `SELECT j.id, j.title, j.dept, j.location, j.type, j.pay, j.body_md, j.html, j.status, j.sort, j.closes_at, j.created_by, j.created_at, j.updated_at,
                (SELECT COUNT(*) FROM job_applications a WHERE a.job_id = j.id) AS applicants
         FROM jobs j
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY j.sort, j.updated_at DESC`
      )
      .bind(...binds)
  );
}

export async function countByStatus(d1: D1Database): Promise<Record<JobStatus, number>> {
  const rows = await all<{ status: JobStatus; n: number }>(d1.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status'));
  const out: Record<JobStatus, number> = { draft: 0, open: 0, closed: 0 };
  for (const r of rows) if (isStatus(r.status)) out[r.status] = r.n;
  return out;
}

/** Postings the public can see and apply to, in careers-page order. */
export async function listOpen(d1: D1Database): Promise<JobRow[]> {
  return all<JobRow>(
    d1
      .prepare(`SELECT ${COLS} FROM jobs WHERE status = 'open' AND (closes_at IS NULL OR closes_at > ?) ORDER BY sort, created_at`)
      .bind(now())
  );
}

export async function getById(d1: D1Database, id: string): Promise<JobRow | null> {
  if (!id || id.length > 80) return null;
  return one<JobRow>(d1.prepare(`SELECT ${COLS} FROM jobs WHERE id = ?`).bind(id));
}

export async function getOpenById(d1: D1Database, id: string): Promise<JobRow | null> {
  const j = await getById(d1, id);
  return j && isAccepting(j) ? j : null;
}

export async function applicantCount(d1: D1Database, id: string): Promise<number> {
  return count(d1, 'SELECT COUNT(*) AS n FROM job_applications WHERE job_id = ?', id);
}

/** A slug from the title that no other posting uses: campus-director, campus-director-2, ... */
export async function idFromTitle(d1: D1Database, title: string, preferred = ''): Promise<string> {
  const base = slugify(preferred) || slugify(title) || 'job';
  let id = base;
  for (let n = 2; await getById(d1, id); n++) id = `${base.slice(0, 76)}-${n}`;
  return id;
}

export async function create(d1: D1Database, id: string, input: JobInput, createdBy: string | null): Promise<JobRow> {
  const ts = now();
  await d1
    .prepare(
      `INSERT INTO jobs (id, title, dept, location, type, pay, body_md, html, status, sort, closes_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.title, input.dept, input.location, input.type, input.pay, input.body_md, bodyHtml(input), input.status, input.sort, input.closes_at, createdBy, ts, ts)
    .run();
  return (await getById(d1, id))!;
}

export async function update(d1: D1Database, id: string, input: JobInput): Promise<void> {
  await d1
    .prepare(
      `UPDATE jobs SET title = ?, dept = ?, location = ?, type = ?, pay = ?, body_md = ?, html = ?, status = ?, sort = ?, closes_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(input.title, input.dept, input.location, input.type, input.pay, input.body_md, bodyHtml(input), input.status, input.sort, input.closes_at, now(), id)
    .run();
}

export async function setStatus(d1: D1Database, id: string, status: JobStatus): Promise<void> {
  await d1.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), id).run();
}

/** Copy a posting into a new draft. Returns the new row. */
export async function duplicate(d1: D1Database, src: JobRow, createdBy: string | null): Promise<JobRow> {
  const title = /\(copy\)$/i.test(src.title) ? src.title : `${src.title} (copy)`;
  const id = await idFromTitle(d1, src.title);
  const ts = now();
  await d1
    .prepare(
      `INSERT INTO jobs (id, title, dept, location, type, pay, body_md, html, status, sort, closes_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, ?, ?, ?)`
    )
    .bind(id, title, src.dept, src.location, src.type, src.pay, src.body_md, src.html, src.sort, createdBy, ts, ts)
    .run();
  return (await getById(d1, id))!;
}

export async function remove(d1: D1Database, id: string): Promise<void> {
  await d1.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
}
