// Staff authentication: password hashing, sessions, invites, roles and
// login throttling. Server-only.
//
// Passwords: PBKDF2-SHA256 (Web Crypto; Workers cap iterations at 100k)
// with a per-user salt, then HMAC'd with SESSION_SECRET so a leaked
// database alone is not enough to crack them offline.
// Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored.
import type { AstroCookies } from 'astro';
import { fromNow, now, newId } from './db';

export const ROLES = ['admin', 'marketing', 'hr', 'admissions'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Super admin',
  marketing: 'Marketing',
  hr: 'HR',
  admissions: 'Admissions',
};

export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, plus staff accounts.',
  marketing: 'Events on the public site.',
  hr: 'Job postings, applicants and the talent pool.',
  admissions: 'Apply Now submissions by program.',
};

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  sessionId: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  roles: string;
  password_hash: string | null;
  status: 'invited' | 'active' | 'disabled';
  invite_hash: string | null;
  invite_expires_at: string | null;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
}

export const SESSION_COOKIE = 'ifs_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const PASSWORD_MIN = 12;
const PBKDF2_ITERATIONS = 100_000;
const MAX_FAILED_LOGINS = 8; // per email or IP, per window
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf: Uint8Array) => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export async function sha256(s: string): Promise<string> {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** The pepper. In production this must be set with `wrangler secret put SESSION_SECRET`. */
export function secretOf(e: Env): string {
  if (e.SESSION_SECRET) return e.SESSION_SECRET;
  if (import.meta.env.PROD) throw new Error('SESSION_SECRET is not set.');
  return 'dev-only-secret-not-for-production';
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  const hk = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', hk, bits));
}

export async function hashPassword(password: string, secret: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const h = await derive(password, salt, PBKDF2_ITERATIONS, secret);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(h)}`;
}

export async function verifyPassword(password: string, stored: string | null, secret: string): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const h = await derive(password, unb64(salt), Number(iter), secret);
  return timingSafeEqual(h, unb64(hash));
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(pw)) return 'Use more than one character.';
  return null;
}

export const parseRoles = (s: string | null | undefined): Role[] => {
  try {
    const arr = JSON.parse(s || '[]');
    return Array.isArray(arr) ? arr.filter((r): r is Role => (ROLES as readonly string[]).includes(r)) : [];
  } catch {
    return [];
  }
};

/** Admins can do everything. */
export const can = (user: SessionUser | null | undefined, role: Role): boolean =>
  !!user && (user.roles.includes('admin') || user.roles.includes(role));

// ---- Sessions ----

export async function createSession(d1: D1Database, userId: string, req: Request): Promise<string> {
  const token = randomToken(32);
  const id = await sha256(token);
  const ts = now();
  await d1
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, ts, fromNow(SESSION_TTL_MS), ts, clientIp(req), (req.headers.get('user-agent') ?? '').slice(0, 300))
    .run();
  // Opportunistic cleanup of expired sessions.
  await d1.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(ts).run();
  return token;
}

export async function getSessionUser(d1: D1Database, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const id = await sha256(token);
  const row = await d1
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.name, u.roles, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .bind(id)
    .first<{ session_id: string; expires_at: string; id: string; email: string; name: string; roles: string; status: string }>();
  if (!row || row.status !== 'active' || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name, roles: parseRoles(row.roles), sessionId: row.session_id };
}

export async function revokeSession(d1: D1Database, sessionId: string) {
  await d1.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export async function revokeUserSessions(d1: D1Database, userId: string) {
  await d1.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export function setSessionCookie(cookies: AstroCookies, token: string) {
  cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

// ---- Login throttling ----

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
}

export async function loginBlocked(d1: D1Database, email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const r = await d1
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ok = 0 AND ts > ? AND (email = ? OR ip = ?)')
    .bind(since, email, ip)
    .first<{ n: number }>();
  return (r?.n ?? 0) >= MAX_FAILED_LOGINS;
}

export async function recordLogin(d1: D1Database, email: string, ip: string, ok: boolean) {
  await d1.prepare('INSERT INTO login_attempts (email, ip, ok, ts) VALUES (?, ?, ?, ?)').bind(email, ip, ok ? 1 : 0, now()).run();
  await d1.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(new Date(Date.now() - 24 * 3600 * 1000).toISOString()).run();
}

// ---- Invites (account setup + password reset) ----

/** Issue a one-time setup token for a user; returns the token to put in the link. */
export async function issueInvite(d1: D1Database, userId: string): Promise<string> {
  const token = randomToken(32);
  await d1
    .prepare('UPDATE users SET invite_hash = ?, invite_expires_at = ? WHERE id = ?')
    .bind(await sha256(token), fromNow(INVITE_TTL_MS), userId)
    .run();
  return token;
}

export async function userForInvite(d1: D1Database, token: string | undefined): Promise<UserRow | null> {
  if (!token || token.length > 200) return null;
  const row = await d1.prepare('SELECT * FROM users WHERE invite_hash = ?').bind(await sha256(token)).first<UserRow>();
  if (!row || row.status === 'disabled') return null;
  if (!row.invite_expires_at || row.invite_expires_at < now()) return null;
  return row;
}

/** Set the password, activate the account, burn the invite and sign out other sessions. */
export async function completeInvite(d1: D1Database, userId: string, password: string, secret: string) {
  await d1
    .prepare("UPDATE users SET password_hash = ?, status = 'active', invite_hash = NULL, invite_expires_at = NULL WHERE id = ?")
    .bind(await hashPassword(password, secret), userId)
    .run();
  await revokeUserSessions(d1, userId);
}

export async function createUser(
  d1: D1Database,
  input: { email: string; name: string; roles: Role[]; createdBy: string | null }
): Promise<UserRow> {
  const id = newId();
  const email = input.email.trim().toLowerCase();
  await d1
    .prepare("INSERT INTO users (id, email, name, roles, status, created_at, created_by) VALUES (?, ?, ?, ?, 'invited', ?, ?)")
    .bind(id, email, input.name.trim(), JSON.stringify(input.roles), now(), input.createdBy)
    .run();
  return (await d1.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>())!;
}
