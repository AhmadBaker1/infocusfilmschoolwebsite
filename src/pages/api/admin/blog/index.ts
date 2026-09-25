// POST /api/admin/blog: create an article (optionally publishing it), then
// open its edit page. Also home to the form reader and cover upload shared
// with /api/admin/blog/[id].
import type { APIRoute } from 'astro';
import { audit, db, files } from '../../../../lib/server/db';
import {
  CATEGORIES,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  STATUSES,
  create,
  restoreMedia,
  setCover,
  uniqueSlug,
  type Category,
  type Post,
  type PostInput,
  type PostStatus,
} from '../../../../lib/server/posts';
import { redirectWithFlash, safeFileName, str } from '../../../../lib/server/http';
import { sanitizeHtml } from '../../../../lib/server/sanitize';
import { fromLocalInput } from '../../../../lib/format';

export const prerender = false;

/**
 * Parse + validate the article form. Returns the input or the first problem.
 * `storedBody` is the body before this edit: the photos and videos the
 * editor showed as marker lines are put back from it.
 */
export async function readPostForm(
  d1: D1Database,
  form: FormData,
  excludeId: string | null,
  storedBody = ''
): Promise<{ ok: true; input: PostInput } | { ok: false; error: string }> {
  const title = str(form, 'title', { max: 160 });
  if (!title) return { ok: false, error: 'Give the article a title.' };

  const publishedRaw = str(form, 'published_at', { max: 30 });
  const published_at = publishedRaw ? fromLocalInput(publishedRaw) : null;
  if (publishedRaw && !published_at) return { ok: false, error: 'The publish date is not valid.' };

  const categoryRaw = str(form, 'category', { max: 20 });
  const category = (CATEGORIES as string[]).includes(categoryRaw) ? (categoryRaw as Category) : 'howto';
  const statusRaw = str(form, 'status', { max: 20 });
  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as PostStatus) : 'draft';

  const slug = await uniqueSlug(d1, str(form, 'slug', { max: 80 }) || title, excludeId);
  // The rich editor submits HTML in `html`; articles keep real headings, and
  // the media blocks it cannot show come back from the stored body.
  const body_html = restoreMedia(sanitizeHtml(str(form, 'html', { max: 600_000 }), { keepHeadings: true }), storedBody);

  return {
    ok: true,
    input: {
      title,
      slug,
      excerpt: str(form, 'excerpt', { max: 300 }),
      category,
      author: str(form, 'author', { max: 120 }),
      cover_alt: str(form, 'cover_alt', { max: 200 }),
      body_html,
      status,
      published_at,
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

/** Store the upload under blog/<id>/ and point the article at it, replacing any previous upload. */
export async function storeCover(locals: App.Locals, post: Pick<Post, 'id' | 'cover_key'>, file: File): Promise<string> {
  const bucket = files(locals);
  const key = `blog/${post.id}/${safeFileName(file.name, 'cover')}`;
  // Buffered: R2 needs a known length, and multipart streams do not carry one.
  await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  if (post.cover_key && post.cover_key !== key) await bucket.delete(post.cover_key);
  await setCover(db(locals), post.id, key);
  return key;
}

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const form = await ctx.request.formData();
  const back = (text: string) => redirectWithFlash(ctx, '/admin/blog/new', { kind: 'error', text });

  const parsed = await readPostForm(d1, form, null);
  if (!parsed.ok) return back(parsed.error);
  const image = pickedImage(form);
  const bad = image && imageProblem(image);
  if (bad) return back(bad);

  const publish = str(form, '_action', { max: 20 }) === 'create_publish';
  if (publish) parsed.input.status = 'published';

  const post = await create(d1, parsed.input, me.id);
  if (image) await storeCover(ctx.locals, post, image);
  await audit(d1, me, post.status === 'published' ? 'post.publish' : 'post.create', 'post', post.id, { title: post.title });

  return redirectWithFlash(ctx, `/admin/blog/${post.id}`, {
    kind: 'ok',
    text: post.status === 'published' ? `"${post.title}" is published at /${post.slug}/.` : `"${post.title}" was saved as a draft.`,
  });
};
