import type { APIRoute } from 'astro';
import { clearSessionCookie, revokeSession } from '../../../lib/server/auth';
import { audit, db } from '../../../lib/server/db';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const user = ctx.locals.user;
  if (user) {
    await revokeSession(db(ctx.locals), user.sessionId);
    await audit(db(ctx.locals), user, 'auth.logout', 'user', user.id);
  }
  clearSessionCookie(ctx.cookies);
  return ctx.redirect('/login', 303);
};

// A GET (e.g. someone typing the URL) just goes to the sign-in page.
export const GET: APIRoute = (ctx) => ctx.redirect('/login', 302);
