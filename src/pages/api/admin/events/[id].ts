// POST /api/admin/events/:id with _action = update | publish | unpublish | archive | duplicate | delete | remove_image
// `publish` from the edit form saves the fields first; from the list it only flips the status.
import type { APIRoute } from 'astro';
import { audit, db, files } from '../../../../lib/server/db';
import { duplicate, getById, remove, setImage, setStatus, update } from '../../../../lib/server/events';
import { redirectWithFlash, safeNext, str } from '../../../../lib/server/http';
import { imageProblem, pickedImage, readEventForm, storeImage } from './index';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const id = ctx.params.id!;
  const ev = await getById(d1, id);
  if (!ev) return new Response('Not found', { status: 404 });

  const form = await ctx.request.formData();
  const action = str(form, '_action', { max: 20 });
  const page = `/admin/events/${id}`;
  const next = safeNext(str(form, 'next', { max: 300 }), page);
  const ok = (text: string, to = next) => redirectWithFlash(ctx, to, { kind: 'ok', text });
  const err = (text: string) => redirectWithFlash(ctx, next, { kind: 'error', text });

  // Full form submissions carry a title; inline list actions do not.
  const saveFields = async (): Promise<Response | null> => {
    if (!form.has('title')) return null;
    const parsed = await readEventForm(d1, form, id);
    if (!parsed.ok) return err(parsed.error);
    const image = pickedImage(form);
    const bad = image && imageProblem(image);
    if (bad) return err(bad);
    if (action === 'publish') parsed.input.status = 'published';
    await update(d1, id, parsed.input);
    if (image) await storeImage(ctx.locals, ev, image);
    return null;
  };

  switch (action) {
    case 'update': {
      const fail = await saveFields();
      if (fail) return fail;
      const saved = (await getById(d1, id))!;
      await audit(d1, me, 'event.update', 'event', id, { title: saved.title });
      return ok('Saved.');
    }
    case 'publish': {
      const fail = await saveFields();
      if (fail) return fail;
      await setStatus(d1, id, 'published');
      const saved = (await getById(d1, id))!;
      await audit(d1, me, 'event.publish', 'event', id, { title: saved.title });
      return ok(`"${saved.title}" is published at /events/${saved.slug}.`);
    }
    case 'unpublish': {
      await setStatus(d1, id, 'draft');
      await audit(d1, me, 'event.unpublish', 'event', id, { title: ev.title });
      return ok(`"${ev.title}" is now a draft and no longer on the public site.`);
    }
    case 'archive': {
      await setStatus(d1, id, 'archived');
      await audit(d1, me, 'event.archive', 'event', id, { title: ev.title });
      return ok(`"${ev.title}" was archived.`);
    }
    case 'duplicate': {
      const bucket = files(ctx.locals);
      const copy = await duplicate(d1, ev, {
        createdBy: me.id,
        copyImage: async (srcKey, newId) => {
          const obj = await bucket.get(srcKey);
          if (!obj) return null;
          const key = `events/${newId}/${srcKey.split('/').pop()}`;
          await bucket.put(key, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
          return key;
        },
      });
      await audit(d1, me, 'event.duplicate', 'event', copy.id, { title: copy.title, from: ev.id });
      return ok(`Draft copy created. You are now editing "${copy.title}".`, `/admin/events/${copy.id}`);
    }
    case 'remove_image': {
      if (ev.image_key) await files(ctx.locals).delete(ev.image_key);
      await setImage(d1, id, null, null);
      await audit(d1, me, 'event.remove_image', 'event', id, { title: ev.title });
      return ok('Image removed.', page);
    }
    case 'delete': {
      if (ev.image_key) await files(ctx.locals).delete(ev.image_key);
      await remove(d1, id);
      await audit(d1, me, 'event.delete', 'event', id, { title: ev.title, slug: ev.slug });
      return ok(`"${ev.title}" was deleted.`, next === page ? '/admin/events' : next);
    }
    default:
      return err('Unknown action.');
  }
};
