// POST /api/admin/applicants/:id with _action = status | notes | delete.
// `back` (optional) is where to return to, e.g. the filtered list.
import type { APIRoute } from 'astro';
import { fullName, isApplicantStatus, statusLabel, type JobApplicationRow } from '../../../../lib/server/applications';
import { audit, db, files, now } from '../../../../lib/server/db';
import { redirectWithFlash, safeNext, str } from '../../../../lib/server/http';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const id = ctx.params.id!;
  const a = await d1.prepare('SELECT * FROM job_applications WHERE id = ?').bind(id).first<JobApplicationRow>();
  if (!a) return new Response('Not found', { status: 404 });

  const form = await ctx.request.formData();
  const action = str(form, '_action', { max: 20 });
  const page = `/admin/applicants/${id}`;
  const back = safeNext(str(form, 'back', { max: 500 }), page);
  const name = fullName(a) || 'Unnamed applicant';
  const ok = (text: string, to = back) => redirectWithFlash(ctx, to, { kind: 'ok', text });
  const err = (text: string) => redirectWithFlash(ctx, back, { kind: 'error', text });

  switch (action) {
    case 'status': {
      const status = str(form, 'status', { max: 20 });
      if (!isApplicantStatus(status)) return err('Pick a valid status.');
      if (status === a.status) return ok(`${name} is already ${statusLabel(status).toLowerCase()}.`);
      await d1.prepare('UPDATE job_applications SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), id).run();
      await audit(d1, me, 'applicant.status', 'applicant', id, { title: name, from: a.status, to: status });
      return ok(`${name}: status set to ${statusLabel(status)}.`);
    }
    case 'notes': {
      const notes = str(form, 'notes', { max: 20_000 });
      await d1.prepare('UPDATE job_applications SET notes = ?, updated_at = ? WHERE id = ?').bind(notes, now(), id).run();
      await audit(d1, me, 'applicant.notes', 'applicant', id, { title: name });
      return ok('Notes saved.', page);
    }
    case 'delete': {
      const bucket = files(ctx.locals);
      const keys = [a.resume_key, a.cover_letter_key].filter((k): k is string => !!k);
      if (keys.length) await bucket.delete(keys);
      await d1.prepare('DELETE FROM job_applications WHERE id = ?').bind(id).run();
      await audit(d1, me, 'applicant.delete', 'applicant', id, { title: name, role: a.role, email: a.email });
      const list = a.job_id ? '/admin/applicants' : '/admin/applicants?tab=pool';
      return redirectWithFlash(ctx, list, { kind: 'ok', text: `${name}'s application was deleted.` });
    }
    default:
      return err('Unknown action.');
  }
};
