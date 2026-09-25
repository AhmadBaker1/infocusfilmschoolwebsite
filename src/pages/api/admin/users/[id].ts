// POST /api/admin/users/:id with _action = update | reinvite | disable | enable | signout | delete
import type { APIRoute } from 'astro';
import { ROLES, issueInvite, revokeUserSessions, type Role, type UserRow } from '../../../../lib/server/auth';
import { audit, db } from '../../../../lib/server/db';
import { isEmail, redirectWithFlash, str } from '../../../../lib/server/http';
import { setupLink } from './index';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const d1 = db(ctx.locals);
  const me = ctx.locals.user!;
  const id = ctx.params.id!;
  const u = await d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!u) return new Response('Not found', { status: 404 });

  const form = await ctx.request.formData();
  const action = str(form, '_action', { max: 20 });
  const page = `/admin/users/${id}`;
  const self = u.id === me.id;
  const ok = (text: string, link?: string) => redirectWithFlash(ctx, page, { kind: 'ok', text, link });
  const err = (text: string) => redirectWithFlash(ctx, page, { kind: 'error', text });

  switch (action) {
    case 'update': {
      const name = str(form, 'name', { max: 80 });
      const email = str(form, 'email', { max: 254 }).toLowerCase();
      let roles = form.getAll('roles').filter((r): r is Role => (ROLES as readonly string[]).includes(String(r)));
      if (self && !roles.includes('admin')) roles = ['admin', ...roles];
      if (!name) return err('Enter their full name.');
      if (!isEmail(email)) return err('Enter a valid email address.');
      if (roles.length === 0) return err('Pick at least one role.');
      const clash = await d1.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(email, id).first();
      if (clash) return err('Another account already uses that email.');
      await d1.prepare('UPDATE users SET name = ?, email = ?, roles = ? WHERE id = ?').bind(name, email, JSON.stringify([...new Set(roles)]), id).run();
      await audit(d1, me, 'user.update', 'user', id, { title: name, roles });
      return ok('Saved.');
    }
    case 'reinvite': {
      if (u.status === 'disabled') return err('Re-enable the account first.');
      const token = await issueInvite(d1, id);
      await audit(d1, me, 'user.reinvite', 'user', id, { title: u.name });
      return ok(`New setup link for ${u.name} (valid 72 hours, works once):`, setupLink(ctx, token));
    }
    case 'disable': {
      if (self) return err('You cannot disable your own account.');
      await d1.prepare("UPDATE users SET status = 'disabled', invite_hash = NULL, invite_expires_at = NULL WHERE id = ?").bind(id).run();
      await revokeUserSessions(d1, id);
      await audit(d1, me, 'user.disable', 'user', id, { title: u.name });
      return ok(`${u.name} is disabled and signed out.`);
    }
    case 'enable': {
      await d1.prepare("UPDATE users SET status = 'invited', password_hash = NULL WHERE id = ?").bind(id).run();
      const token = await issueInvite(d1, id);
      await audit(d1, me, 'user.enable', 'user', id, { title: u.name });
      return ok(`${u.name} is re-enabled. Send them this setup link:`, setupLink(ctx, token));
    }
    case 'signout': {
      await revokeUserSessions(d1, id);
      await audit(d1, me, 'user.signout_all', 'user', id, { title: u.name });
      if (self) return ctx.redirect('/login', 303);
      return ok(`${u.name} has been signed out everywhere.`);
    }
    case 'delete': {
      if (self) return err('You cannot delete your own account.');
      await d1.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
      await audit(d1, me, 'user.delete', 'user', id, { title: u.name, email: u.email });
      return redirectWithFlash(ctx, '/admin/users', { kind: 'ok', text: `${u.name}'s account was deleted.` });
    }
    default:
      return err('Unknown action.');
  }
};
