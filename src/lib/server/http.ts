// Request/response helpers shared by API routes and admin pages. Server-only.
import type { APIContext, AstroCookies } from 'astro';

export const FLASH_COOKIE = 'ifs_flash';

export interface Flash {
  kind: 'ok' | 'error' | 'info';
  text: string;
  /* Optional link shown with the message (e.g. an invite URL). */
  link?: string;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export const badRequest = (message: string, fields?: Record<string, string>) => json({ ok: false, message, fields }, 400);
export const forbidden = (message = 'Not allowed.') => json({ ok: false, message }, 403);
export const notFound = (message = 'Not found.') => json({ ok: false, message }, 404);

/** Post-redirect-get with a one-shot message for the admin layout to show. */
export function setFlash(cookies: AstroCookies, flash: Flash) {
  cookies.set(FLASH_COOKIE, JSON.stringify(flash), {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: 120,
  });
}

export function takeFlash(cookies: AstroCookies): Flash | null {
  const raw = cookies.get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  cookies.delete(FLASH_COOKIE, { path: '/' });
  try {
    return JSON.parse(raw) as Flash;
  } catch {
    return null;
  }
}

export function redirectWithFlash(ctx: APIContext, to: string, flash: Flash): Response {
  setFlash(ctx.cookies, flash);
  return ctx.redirect(to, 303);
}

/** Only allow redirects back into the site. */
export function safeNext(next: string | null | undefined, fallback = '/admin'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}

/** Does the browser want JSON (fetch) rather than a redirect (plain form post)? */
export function wantsJson(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('application/json') || request.headers.get('x-requested-with') === 'fetch';
}

// ---- Form field readers with light validation ----

export function str(form: FormData, key: string, opts: { max?: number; required?: boolean } = {}): string {
  const v = form.get(key);
  const s = (typeof v === 'string' ? v : '').replace(/\r\n/g, '\n').trim();
  const max = opts.max ?? 500;
  if (s.length > max) return s.slice(0, max);
  return s;
}

export function missing(form: FormData, keys: string[]): string[] {
  return keys.filter((k) => !str(form, k, { max: 100_000 }));
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

export function isUrl(s: string): boolean {
  if (!s) return true;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Safe file name for R2 keys: keeps letters, digits, dot, dash, underscore. */
export function safeFileName(name: string, fallback = 'file'): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 120);
  return clean || fallback;
}

/** Throttle public submissions per IP: at most `limit` per `windowMs`. */
export async function throttled(d1: D1Database, ip: string, kind: string, limit = 5, windowMs = 60 * 60 * 1000): Promise<boolean> {
  if (!ip) return false;
  const since = new Date(Date.now() - windowMs).toISOString();
  const r = await d1.prepare('SELECT COUNT(*) AS n FROM submission_log WHERE ip = ? AND kind = ? AND ts > ?').bind(ip, kind, since).first<{ n: number }>();
  if ((r?.n ?? 0) >= limit) return true;
  await d1.prepare('INSERT INTO submission_log (ip, kind, ts) VALUES (?, ?, ?)').bind(ip, kind, new Date().toISOString()).run();
  await d1.prepare('DELETE FROM submission_log WHERE ts < ?').bind(new Date(Date.now() - 24 * 3600 * 1000).toISOString()).run();
  return false;
}
