// Gates the staff area. Loads the session for /admin, /login and /api
// routes, redirects signed-out visitors to /login, enforces roles per
// section, and adds no-cache / noindex headers so nothing private is
// stored or crawled. Public pages are untouched (and prerendered pages never
// hit this at request time).
import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, canSection, getSessionUser, type Section } from './lib/server/auth';
import { json, safeNext } from './lib/server/http';

// Which section each path belongs to; roles per section live in SECTIONS.
const GATES: [RegExp, Section][] = [
  [/^\/(admin|api\/admin)\/events(\/|$)/, 'events'],
  [/^\/(admin|api\/admin)\/blog(\/|$)/, 'blog'],
  [/^\/(admin|api\/admin)\/jobs(\/|$)/, 'jobs'],
  [/^\/(admin|api\/admin)\/applicants(\/|$)/, 'applicants'],
  [/^\/(admin|api\/admin)\/files(\/|$)/, 'files'],
  [/^\/(admin|api\/admin)\/admissions(\/|$)/, 'admissions'],
  [/^\/(admin|api\/admin)\/users(\/|$)/, 'users'],
];

const PRIVATE = /^\/(admin|login|api\/(admin|auth))(\/|$)/;

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  ctx.locals.user = null;

  if (!PRIVATE.test(path)) return next();

  const env = ctx.locals.runtime?.env;
  if (!env) return next();

  const token = ctx.cookies.get(SESSION_COOKIE)?.value;
  ctx.locals.user = await getSessionUser(env.DB, token);
  const user = ctx.locals.user;
  const isApi = path.startsWith('/api/');

  if (path.startsWith('/admin') || path.startsWith('/api/admin')) {
    if (!user) {
      if (isApi) return json({ ok: false, message: 'Please sign in.' }, 401);
      const back = safeNext(path + ctx.url.search);
      return ctx.redirect(`/login?next=${encodeURIComponent(back)}`, 302);
    }
    for (const [re, section] of GATES) {
      if (re.test(path) && !canSection(user, section)) {
        if (isApi) return json({ ok: false, message: 'Your account does not have access to this section.' }, 403);
        return ctx.rewrite('/admin/forbidden');
      }
    }
  }

  const res = await next();
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'same-origin');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
});
