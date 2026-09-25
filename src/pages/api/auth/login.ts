import type { APIRoute } from 'astro';
import {
  clientIp,
  createSession,
  loginBlocked,
  recordLogin,
  secretOf,
  setSessionCookie,
  verifyPassword,
  type UserRow,
} from '../../../lib/server/auth';
import { audit, db, env, now } from '../../../lib/server/db';
import { safeNext, str } from '../../../lib/server/http';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const email = str(form, 'email', { max: 254 }).toLowerCase();
  const password = str(form, 'password', { max: 200 });
  const next = safeNext(str(form, 'next'));
  const back = (code: string) => ctx.redirect(`/login?error=${code}&next=${encodeURIComponent(next)}`, 303);

  const d1 = db(ctx.locals);
  const ip = clientIp(ctx.request);

  if (!email || !password) return back('1');
  if (await loginBlocked(d1, email, ip)) return back('locked');

  const user = await d1.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  const ok = !!user && user.status === 'active' && (await verifyPassword(password, user.password_hash, secretOf(env(ctx.locals))));
  await recordLogin(d1, email, ip, ok);

  if (!ok) {
    // Same message whether the account exists or not.
    if (user && user.status === 'disabled' && (await verifyPassword(password, user.password_hash, secretOf(env(ctx.locals))))) return back('disabled');
    return back('1');
  }

  const token = await createSession(d1, user!.id, ctx.request);
  setSessionCookie(ctx.cookies, token);
  await d1.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user!.id).run();
  await audit(d1, { id: user!.id, name: user!.name }, 'auth.login', 'user', user!.id, { ip });
  return ctx.redirect(next, 303);
};
