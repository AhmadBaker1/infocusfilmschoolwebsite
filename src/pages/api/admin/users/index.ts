// POST /api/admin/users: create a staff account and issue its setup link.
import type { APIRoute } from 'astro';
import { ROLES, createUser, issueInvite, type Role } from '../../../../lib/server/auth';
import { audit, db, env } from '../../../../lib/server/db';
import { isEmail, redirectWithFlash, str } from '../../../../lib/server/http';

export const prerender = false;

export function setupLink(ctx: Parameters<APIRoute>[0], token: string): string {
  const base = env(ctx.locals).SITE_URL && import.meta.env.PROD ? env(ctx.locals).SITE_URL! : ctx.url.origin;
  return `${base.replace(/\/$/, '')}/login/setup?token=${token}`;
}

export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const name = str(form, 'name', { max: 80 });
  const email = str(form, 'email', { max: 254 }).toLowerCase();
  const roles = form.getAll('roles').filter((r): r is Role => (ROLES as readonly string[]).includes(String(r)));
  const back = (text: string) => redirectWithFlash(ctx, '/admin/users#invite', { kind: 'error', text });

  if (!name) return back('Enter their full name.');
  if (!isEmail(email)) return back('Enter a valid email address.');
  if (roles.length === 0) return back('Pick at least one role.');

  const d1 = db(ctx.locals);
  const exists = await d1.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return back('An account with that email already exists.');

  const user = await createUser(d1, { email, name, roles, createdBy: ctx.locals.user!.id });
  const token = await issueInvite(d1, user.id);
  await audit(d1, ctx.locals.user, 'user.invite', 'user', user.id, { title: user.name, roles });

  return redirectWithFlash(ctx, `/admin/users/${user.id}`, {
    kind: 'ok',
    text: `${user.name} was added. Send them this setup link (valid 72 hours, works once):`,
    link: setupLink(ctx, token),
  });
};
