import type { APIRoute } from 'astro';
import { completeInvite, passwordProblem, secretOf, userForInvite } from '../../../lib/server/auth';
import { audit, db, env } from '../../../lib/server/db';
import { str } from '../../../lib/server/http';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const token = str(form, 'token', { max: 200 });
  const password = str(form, 'password', { max: 200 });
  const confirm = str(form, 'confirm', { max: 200 });
  const back = (code: string) => ctx.redirect(`/login/setup?token=${encodeURIComponent(token)}&error=${code}`, 303);

  const d1 = db(ctx.locals);
  const user = await userForInvite(d1, token);
  if (!user) return ctx.redirect('/login/setup', 303);
  if (passwordProblem(password)) return back('weak');
  if (password !== confirm) return back('match');

  await completeInvite(d1, user.id, password, secretOf(env(ctx.locals)));
  await audit(d1, { id: user.id, name: user.name }, 'auth.password_set', 'user', user.id);
  return ctx.redirect('/login?setup=done', 303);
};
