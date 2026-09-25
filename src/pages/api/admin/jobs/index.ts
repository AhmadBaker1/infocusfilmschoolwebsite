// POST /api/admin/jobs: create a job posting. The form is shared with the
// edit page (src/components/admin/JobForm.astro); readJobInput is used by
// both routes.
import type { APIRoute } from 'astro';
import { DEPTS } from '../../../../lib/jobs';
import { fromLocalInput } from '../../../../lib/format';
import { audit, db } from '../../../../lib/server/db';
import { redirectWithFlash, slugify, str } from '../../../../lib/server/http';
import { create, idFromTitle, isDept, isStatus, type JobInput } from '../../../../lib/server/jobs';
import { sanitizeHtml } from '../../../../lib/server/sanitize';

export const prerender = false;

/** Parse + validate the posting form. Returns the input or an error message. */
export function readJobInput(form: FormData): { ok: true; input: JobInput } | { ok: false; error: string } {
  const title = str(form, 'title', { max: 120 });
  const dept = str(form, 'dept', { max: 40 });
  const status = str(form, 'status', { max: 10 }) || 'draft';
  const closesDate = str(form, 'closes_at', { max: 10 });
  const sortRaw = str(form, 'sort', { max: 10 });
  const sort = sortRaw === '' ? 0 : Number(sortRaw);

  if (!title) return { ok: false, error: 'Enter a job title.' };
  if (!isDept(dept)) return { ok: false, error: `Pick a team (${Object.values(DEPTS).join(', ')}).` };
  if (!isStatus(status)) return { ok: false, error: 'Unknown status.' };
  if (!Number.isInteger(sort) || sort < -9999 || sort > 9999) return { ok: false, error: 'Sort must be a whole number.' };

  // The closing date is a calendar day in Mountain Time; the posting stays up through the end of that day.
  let closes_at: string | null = null;
  if (closesDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closesDate)) return { ok: false, error: 'Closing date must be a date (YYYY-MM-DD).' };
    closes_at = fromLocalInput(`${closesDate}T23:59`);
    if (!closes_at) return { ok: false, error: 'Closing date is not a valid date.' };
  }

  return {
    ok: true,
    input: {
      title,
      dept,
      location: str(form, 'location', { max: 120 }),
      type: str(form, 'type', { max: 120 }),
      pay: str(form, 'pay', { max: 120 }),
      body_md: '',
      html: sanitizeHtml(str(form, 'html', { max: 400_000 })),
      status,
      sort,
      closes_at,
    },
  };
}

export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const back = (text: string) => redirectWithFlash(ctx, '/admin/jobs/new', { kind: 'error', text });

  const r = readJobInput(form);
  if (!r.ok) return back(r.error);
  const input = r.input;
  // "Save + open" button.
  if (str(form, '_then', { max: 10 }) === 'open') input.status = 'open';

  const d1 = db(ctx.locals);
  const wanted = slugify(str(form, 'id', { max: 80 }));
  if (wanted && wanted !== str(form, 'id', { max: 80 })) return back('The URL slug can only contain lower-case letters, numbers and dashes.');
  const id = await idFromTitle(d1, input.title, wanted);
  if (wanted && id !== wanted) return back(`Another posting already uses /careers/${wanted}. Pick a different slug.`);

  const job = await create(d1, id, input, ctx.locals.user!.id);
  await audit(d1, ctx.locals.user, 'job.create', 'job', job.id, { title: job.title, status: job.status });

  return redirectWithFlash(ctx, `/admin/jobs/${job.id}`, {
    kind: 'ok',
    text: job.status === 'open' ? `${job.title} is live at /careers/${job.id}.` : `${job.title} was saved as a ${job.status === 'draft' ? 'draft' : job.status + ' posting'}.`,
  });
};
