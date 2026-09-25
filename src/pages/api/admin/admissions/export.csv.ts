// GET /api/admin/admissions/export.csv?status=&program=&q=
// The current list view as CSV (every column except private notes).
import type { APIRoute } from 'astro';
import { admissionFilters, admissionWhere, csv, csvResponse, type AdmissionRow } from '../../../../lib/server/applications';
import { all, audit, db } from '../../../../lib/server/db';

export const prerender = false;

const COLUMNS: (keyof AdmissionRow)[] = [
  'id',
  'created_at',
  'status',
  'program',
  'program_name',
  'first_name',
  'last_name',
  'email',
  'phone_country',
  'phone',
  'city',
  'country',
  'heard_from',
  'ip',
  'updated_at',
];

export const GET: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const f = admissionFilters(ctx.url.searchParams);
  const where = admissionWhere(f);
  const rows = await all<AdmissionRow>(
    d1.prepare(`SELECT * FROM admissions_applications WHERE ${where.sql} ORDER BY created_at DESC`).bind(...where.binds)
  );
  await audit(d1, ctx.locals.user, 'admission.export', 'admission', null, { title: `${rows.length} rows`, filters: f });
  const day = new Date().toISOString().slice(0, 10);
  const body = csv(COLUMNS, rows.map((r) => COLUMNS.map((c) => r[c])));
  return csvResponse(`admissions-${day}.csv`, body);
};
