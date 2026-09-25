// GET /files/blog/<id>/<name>: streams an article cover from R2. Covers are
// public, so this route has no auth; the key must stay under blog/ so
// nothing else in the bucket is reachable.
import type { APIRoute } from 'astro';
import { files } from '../../../lib/server/db';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const rest = ctx.params.key ?? '';
  if (!rest || rest.includes('..')) return new Response(null, { status: 404 });
  const key = `blog/${rest}`;

  const obj = await files(ctx.locals).get(key);
  if (!obj) return new Response(null, { status: 404 });

  const etag = `"${obj.httpEtag.replace(/"/g, '')}"`;
  const headers = new Headers({
    'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'cache-control': 'public, max-age=86400',
    etag,
  });
  if (ctx.request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  headers.set('content-length', String(obj.size));
  // R2's stream type comes from workers-types; the runtime one is what Response wants.
  return new Response(obj.body as unknown as ReadableStream, { headers });
};
