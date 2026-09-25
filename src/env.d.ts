/// <reference types="astro/client" />

// Cloudflare binding types are imported by name rather than as a global
// reference: the workers-types globals (Response, Element, ...) clash with
// the DOM types used in client <script>s.
type D1Database = import('@cloudflare/workers-types').D1Database;
type D1PreparedStatement = import('@cloudflare/workers-types').D1PreparedStatement;
type R2Bucket = import('@cloudflare/workers-types').R2Bucket;
type R2Object = import('@cloudflare/workers-types').R2Object;
type R2ObjectBody = import('@cloudflare/workers-types').R2ObjectBody;
type Fetcher = import('@cloudflare/workers-types').Fetcher;

// Bindings from wrangler.jsonc, plus secrets.
interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  SITE_URL?: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /* Signed-in staff member, set by src/middleware.ts on /admin, /login and /api routes. */
    user: import('./lib/server/auth').SessionUser | null;
  }
}
