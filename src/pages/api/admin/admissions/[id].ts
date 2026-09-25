// POST /api/admin/admissions/:id with _action = status | notes | delete.
// `back` (optional) is where to return to, e.g. the filtered list.
import type { APIRoute } from 'astro';
import { fullName, isAdmissionStatus, statusLabel, type AdmissionRow } from '../../../../lib/server/applications';
import { audit, db, now } from '../../../../lib/server/db';
import { redirectWithFlash, safeNext, str } from '../../../../lib/server/http';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const id = ctx.params.id!;
  const a = await d1.prepare('SELECT * FROM admissions_applications WHERE id = ?').bind(id).first<AdmissionRow>();
  if (!a) return new Response('Not found', { status: 404 });

  const form = await ctx.request.formData();
  const action = str(form, '_action', { max: 20 });
  const page = `/admin/admissions/${id}`;
  const back = safeNext(str(form, 'back', { max: 500 }), page);
  const name = fullName(a) || 'Unnamed applicant';
  const ok = (text: string, to = back) => redirectWithFlash(ctx, to, { kind: 'ok', text });
  const err = (text: string) => redirectWithFlash(ctx, back, { kind: 'error', text });

  switch (action) {
    case 'status': {
      const status = str(form, 'status', { max: 20 });
      if (!isAdmissionStatus(status)) return err('Pick a valid status.');
      if (status === a.status) return ok(`${name} is already ${statusLabel(status).toLowerCase()}.`);
      await d1.prepare('UPDATE admissions_applications SET status = ?, updated_at = ? WHERE id = ?').bind(status, now(), id).run();
      await audit(d1, me, 'admission.status', 'admission', id, { title: name, from: a.status, to: status });
      return ok(`${name}: status set to ${statusLabel(status)}.`);
    }
    case 'notes': {
      const notes = str(form, 'notes', { max: 20_000 });
      await d1.prepare('UPDATE admissions_applications SET notes = ?, updated_at = ? WHERE id = ?').bind(notes, now(), id).run();
      await audit(d1, me, 'admission.notes', 'admission', id, { title: name });
      return ok('Notes saved.', page);
    }
    case 'delete': {
      await d1.prepare('DELETE FROM admissions_applications WHERE id = ?').bind(id).run();
      await audit(d1, me, 'admission.delete', 'admission', id, { title: name, program: a.program_name, email: a.email });
      return redirectWithFlash(ctx, '/admin/admissions', { kind: 'ok', text: `${name}'s application was deleted.` });
    }
    default:
      return err('Unknown action.');
  }
};
