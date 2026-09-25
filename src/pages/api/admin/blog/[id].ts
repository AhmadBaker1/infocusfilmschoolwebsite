// POST /api/admin/blog/:id with _action = update | publish | unpublish | duplicate | delete | remove_image
// `publish` from the edit form saves the fields first; from the list it only flips the status.
import type { APIRoute } from 'astro';
import { audit, db, files } from '../../../../lib/server/db';
import { duplicate, getById, remove, setCover, setStatus, update } from '../../../../lib/server/posts';
import { redirectWithFlash, safeNext, str } from '../../../../lib/server/http';
import { imageProblem, pickedImage, readPostForm, storeCover } from './index';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const id = ctx.params.id!;
  const post = await getById(d1, id);
  if (!post) return new Response('Not found', { status: 404 });

  const form = await ctx.request.formData();
  const action = str(form, '_action', { max: 20 });
  const page = `/admin/blog/${id}`;
  const next = safeNext(str(form, 'next', { max: 300 }), page);
  const ok = (text: string, to = next) => redirectWithFlash(ctx, to, { kind: 'ok', text });
  const err = (text: string) => redirectWithFlash(ctx, next, { kind: 'error', text });

  // Full form submissions carry a title; inline list actions do not.
  const saveFields = async (): Promise<Response | null> => {
    if (!form.has('title')) return null;
    const parsed = await readPostForm(d1, form, id, post.body_html);
    if (!parsed.ok) return err(parsed.error);
    const image = pickedImage(form);
    const bad = image && imageProblem(image);
    if (bad) return err(bad);
    if (action === 'publish') parsed.input.status = 'published';
    await update(d1, id, parsed.input);
    if (image) await storeCover(ctx.locals, post, image);
    return null;
  };

  switch (action) {
    case 'update': {
      const fail = await saveFields();
      if (fail) return fail;
      const saved = (await getById(d1, id))!;
      await audit(d1, me, 'post.update', 'post', id, { title: saved.title });
      return ok('Saved.');
    }
    case 'publish': {
      const fail = await saveFields();
      if (fail) return fail;
      await setStatus(d1, id, 'published');
      const saved = (await getById(d1, id))!;
      await audit(d1, me, 'post.publish', 'post', id, { title: saved.title });
      return ok(`"${saved.title}" is published at /${saved.slug}/.`);
    }
    case 'unpublish': {
      await setStatus(d1, id, 'draft');
      await audit(d1, me, 'post.unpublish', 'post', id, { title: post.title });
      return ok(`"${post.title}" is now a draft and no longer on the public site.`);
    }
    case 'duplicate': {
      const bucket = files(ctx.locals);
      const copy = await duplicate(d1, post, {
        createdBy: me.id,
        copyImage: async (srcKey, newId) => {
          const obj = await bucket.get(srcKey);
          if (!obj) return null;
          const key = `blog/${newId}/${srcKey.split('/').pop()}`;
          await bucket.put(key, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
          return key;
        },
      });
      await audit(d1, me, 'post.duplicate', 'post', copy.id, { title: copy.title, from: post.id });
      return ok(`Draft copy created. You are now editing "${copy.title}".`, `/admin/blog/${copy.id}`);
    }
    case 'remove_image': {
      if (post.cover_key) await files(ctx.locals).delete(post.cover_key);
      await setCover(d1, id, null, '');
      await audit(d1, me, 'post.remove_image', 'post', id, { title: post.title });
      return ok('Cover image removed.', page);
    }
    case 'delete': {
      if (post.cover_key) await files(ctx.locals).delete(post.cover_key);
      await remove(d1, id);
      await audit(d1, me, 'post.delete', 'post', id, { title: post.title, slug: post.slug });
      return ok(`"${post.title}" was deleted.`, next === page ? '/admin/blog' : next);
    }
    default:
      return err('Unknown action.');
  }
};
