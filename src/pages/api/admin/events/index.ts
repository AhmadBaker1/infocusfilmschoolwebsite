// POST /api/admin/events: create an event (optionally publishing it), then
// open its edit page. Also home to the form reader and image upload shared
// with /api/admin/events/[id].
import type { APIRoute } from 'astro';
import { audit, db, files } from '../../../../lib/server/db';
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  MODES,
  STATUSES,
  create,
  setImage,
  uniqueSlug,
  type Event,
  type EventInput,
  type EventMode,
  type EventStatus,
} from '../../../../lib/server/events';
import { isUrl, redirectWithFlash, safeFileName, str } from '../../../../lib/server/http';
import { sanitizeHtml } from '../../../../lib/server/sanitize';
import { fromLocalInput } from '../../../../lib/format';

export const prerender = false;

/** Parse + validate the event form. Returns the input or the first problem. */
export async function readEventForm(
  d1: D1Database,
  form: FormData,
  excludeId: string | null
): Promise<{ ok: true; input: EventInput } | { ok: false; error: string }> {
  const title = str(form, 'title', { max: 160 });
  if (!title) return { ok: false, error: 'Give the event a title.' };

  const startsRaw = str(form, 'starts_at', { max: 30 });
  const starts_at = startsRaw ? fromLocalInput(startsRaw) : null;
  if (!starts_at) return { ok: false, error: 'Enter a valid start date and time.' };

  const endsRaw = str(form, 'ends_at', { max: 30 });
  const ends_at = endsRaw ? fromLocalInput(endsRaw) : null;
  if (endsRaw && !ends_at) return { ok: false, error: 'The end date and time is not valid.' };
  if (ends_at && ends_at <= starts_at) return { ok: false, error: 'The event must end after it starts.' };

  const register_url = str(form, 'register_url', { max: 500 });
  if (!isUrl(register_url)) return { ok: false, error: 'The registration link must start with https:// or http://.' };

  const modeRaw = str(form, 'mode', { max: 20 });
  const mode = (MODES as string[]).includes(modeRaw) ? (modeRaw as EventMode) : 'in-person';
  const statusRaw = str(form, 'status', { max: 20 });
  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as EventStatus) : 'draft';

  const slug = await uniqueSlug(d1, str(form, 'slug', { max: 80 }) || title, excludeId);
  // The rich editor submits HTML in `html`; body_md is no longer written.
  const body_html = sanitizeHtml(str(form, 'html', { max: 400_000 }));

  return {
    ok: true,
    input: {
      title,
      slug,
      summary: str(form, 'summary', { max: 300 }),
      body_md: '',
      body_html,
      starts_at,
      ends_at,
      location: str(form, 'location', { max: 200 }),
      mode,
      register_url: register_url || null,
      image_alt: str(form, 'image_alt', { max: 200 }),
      status,
      featured: form.get('featured') === '1',
    },
  };
}

/** A picked file, or null when the file input was left empty. */
export function pickedImage(form: FormData): File | null {
  const f = form.get('image');
  return f instanceof File && f.size > 0 ? f : null;
}

export function imageProblem(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'The image must be a JPG, PNG or WebP.';
  if (file.size > IMAGE_MAX_BYTES) return 'The image must be 5 MB or smaller.';
  return null;
}

/** Store the upload under events/<id>/ and point the event at it, replacing any previous image. */
export async function storeImage(locals: App.Locals, ev: Pick<Event, 'id' | 'image_key'>, file: File): Promise<string> {
  const bucket = files(locals);
  const key = `events/${ev.id}/${safeFileName(file.name, 'image')}`;
  // Buffered: R2 needs a known length, and multipart streams do not carry one.
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (ev.image_key && ev.image_key !== key) await bucket.delete(ev.image_key);
  await setImage(db(locals), ev.id, key);
  return key;
}

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const form = await ctx.request.formData();
  const back = (text: string) => redirectWithFlash(ctx, '/admin/events/new', { kind: 'error', text });

  const parsed = await readEventForm(d1, form, null);
  if (!parsed.ok) return back(parsed.error);
  const image = pickedImage(form);
  const bad = image && imageProblem(image);
  if (bad) return back(bad);

  const publish = str(form, '_action', { max: 20 }) === 'create_publish';
  if (publish) parsed.input.status = 'published';

  const ev = await create(d1, parsed.input, me.id);
  if (image) await storeImage(ctx.locals, ev, image);
  await audit(d1, me, publish ? 'event.publish' : 'event.create', 'event', ev.id, { title: ev.title });

  return redirectWithFlash(ctx, `/admin/events/${ev.id}`, {
    kind: 'ok',
    text: publish ? `"${ev.title}" is published at /events/${ev.slug}.` : `"${ev.title}" was saved as a ${ev.status === 'draft' ? 'draft' : ev.status + ' event'}.`,
  });
};
