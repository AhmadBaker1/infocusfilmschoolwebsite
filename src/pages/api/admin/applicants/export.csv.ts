// GET /api/admin/applicants/export.csv?tab=&status=&job=&q=
// The current list view as CSV (every column except private notes).
import type { APIRoute } from 'astro';
import { applicantFilters, applicantWhere, csv, csvResponse, type JobApplicationRow } from '../../../../lib/server/applications';
import { all, audit, db } from '../../../../lib/server/db';

export const prerender = false;

const COLUMNS: (keyof JobApplicationRow)[] = [
  'id',
  'created_at',
  'status',
  'role',
  'job_id',
  'first_name',
  'last_name',
  'email',
  'phone_country',
  'phone',
  'city',
  'province',
  'country',
  'work_eligible',
  'resume_name',
  'cover_letter_name',
  'cover_letter',
  'portfolio_url',
  'linkedin_url',
  'start_date',
  'heard_from',
  'ip',
  'updated_at',
];

export const GET: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const f = applicantFilters(ctx.url.searchParams);
  const where = applicantWhere(f);
  const rows = await all<JobApplicationRow>(
    d1.prepare(`SELECT * FROM job_applications WHERE ${where.sql} ORDER BY created_at DESC`).bind(...where.binds)
  );
  await audit(d1, ctx.locals.user, 'applicant.export', 'applicant', null, { title: `${rows.length} rows`, filters: f });
  const day = new Date().toISOString().slice(0, 10);
  const body = csv(COLUMNS, rows.map((r) => COLUMNS.map((c) => r[c])));
  return csvResponse(`applicants-${f.tab === 'pool' ? 'talent-pool' : 'roles'}-${day}.csv`, body);
};
