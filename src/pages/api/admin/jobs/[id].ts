// POST /api/admin/jobs/:id with _action = update | open | close | draft | duplicate | delete
import type { APIRoute } from 'astro';
import { audit, db } from '../../../../lib/server/db';
import { redirectWithFlash, str } from '../../../../lib/server/http';
import { applicantCount, duplicate, getById, remove, setStatus, update } from '../../../../lib/server/jobs';
import { readJobInput } from './index';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const id = ctx.params.id!;
  const job = await getById(d1, id);
  if (!job) return new Response('Not found', { status: 404 });

  const form = await ctx.request.formData();
  const action = str(form, '_action', { max: 20 });
  // Where to land afterwards: the list (from its inline buttons) or the edit page.
  const back = str(form, '_back', { max: 200 }).startsWith('/admin/jobs') ? str(form, '_back', { max: 200 }) : `/admin/jobs/${id}`;
  const ok = (text: string, to = back) => redirectWithFlash(ctx, to, { kind: 'ok', text });
  const err = (text: string, to = back) => redirectWithFlash(ctx, to, { kind: 'error', text });

  switch (action) {
    case 'update': {
      const r = readJobInput(form);
      if (!r.ok) return err(r.error);
      const input = r.input;
      // "Save + open" button.
      if (str(form, '_then', { max: 10 }) === 'open') input.status = 'open';
      await update(d1, id, input);
      await audit(d1, me, 'job.update', 'job', id, { title: input.title, status: input.status });
      return ok(input.status === 'open' ? `Saved. ${input.title} is live at /careers/${id}.` : 'Saved.');
    }
    case 'open': {
      await setStatus(d1, id, 'open');
      await audit(d1, me, 'job.open', 'job', id, { title: job.title });
      return ok(`${job.title} is now open at /careers/${id}.`);
    }
    case 'close': {
      await setStatus(d1, id, 'closed');
      await audit(d1, me, 'job.close', 'job', id, { title: job.title });
      return ok(`${job.title} is closed. Its page stays up with a "no longer accepting applications" notice.`);
    }
    case 'draft': {
      await setStatus(d1, id, 'draft');
      await audit(d1, me, 'job.draft', 'job', id, { title: job.title });
      return ok(`${job.title} is back to a draft and hidden from the careers page.`);
    }
    case 'duplicate': {
      const copy = await duplicate(d1, job, me.id);
      await audit(d1, me, 'job.duplicate', 'job', copy.id, { title: copy.title, from: job.id });
      return ok(`Copied ${job.title} to a new draft. Edit it below, then open it when ready.`, `/admin/jobs/${copy.id}`);
    }
    case 'delete': {
      const n = await applicantCount(d1, id);
      if (n > 0) return err(`${job.title} has ${n} application${n === 1 ? '' : 's'} and cannot be deleted. Close it instead to keep the records.`);
      await remove(d1, id);
      await audit(d1, me, 'job.delete', 'job', id, { title: job.title });
      return ok(`${job.title} was deleted.`, '/admin/jobs');
    }
    default:
      return err('Unknown action.');
  }
};
