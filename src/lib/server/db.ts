// Small helpers around the D1 binding. Server-only.

export function env(locals: App.Locals): Env {
  const e = locals.runtime?.env;
  if (!e) throw new Error('Cloudflare runtime is not available. Is this route prerendered?');
  return e;
}

export const db = (locals: App.Locals) => env(locals).DB;
export const files = (locals: App.Locals) => env(locals).FILES;

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** ISO string for `ms` milliseconds from now. */
export const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

export async function one<T>(stmt: D1PreparedStatement): Promise<T | null> {
  return (await stmt.first<T>()) ?? null;
}

export async function all<T>(stmt: D1PreparedStatement): Promise<T[]> {
  const r = await stmt.all<T>();
  return r.results ?? [];
}

export async function count(d1: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const r = await d1.prepare(sql).bind(...binds).first<{ n: number }>();
  return r?.n ?? 0;
}

/** Append to the audit log. Never throws; a failed audit must not block the action. */
export async function audit(
  d1: D1Database,
  user: { id: string; name: string } | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta?: Record<string, unknown>
) {
  try {
    await d1
      .prepare('INSERT INTO audit_log (ts, user_id, user_name, action, entity, entity_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(now(), user?.id ?? null, user?.name ?? null, action, entity, entityId, meta ? JSON.stringify(meta) : null)
      .run();
  } catch (e) {
    console.error('audit failed', e);
  }
}
