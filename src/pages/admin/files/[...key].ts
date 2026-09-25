// GET /admin/files/<r2 key>: private download of an applicant's document.
// The middleware limits /admin/files to HR; this route only serves keys
// under applications/ and never caches.
import type { APIRoute } from 'astro';
import { files } from '../../../lib/server/db';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const key = ctx.params.key ?? '';
  if (!key.startsWith('applications/') || key.includes('..')) return new Response('Not found', { status: 404 });

  const obj = await files(ctx.locals).get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const name = key.split('/').pop() || 'file';
  return new Response(obj.body as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'content-length': String(obj.size),
      'content-disposition': `attachment; filename="${name.replace(/["\\]/g, '')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
