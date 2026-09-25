// Date/time formatting shared by public pages and the staff area. Times are
// stored as ISO UTC; everything on screen is Mountain Time (Calgary) unless
// told otherwise.

export const TZ = 'America/Edmonton';
export const TZ_LABEL = 'MT';

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}, tz = TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', ...opts }).format(d);
}

export function fmtTime(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d).replace(/\./g, '').toLowerCase();
}

export function fmtDateTime(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return '';
  return `${fmtDate(iso, { weekday: 'short' }, tz)}, ${fmtTime(iso, tz)}`;
}

/** "3 min ago", "2 days ago". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return fmtDate(iso);
}

/** Value for <input type="datetime-local"> in the given zone. */
export function toLocalInput(iso: string | null | undefined, tz = TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/** Parse a datetime-local value entered in `tz` into ISO UTC. */
export function fromLocalInput(value: string, tz = TZ): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Guess UTC, then correct by the zone's offset at that instant.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = zoneOffsetMs(new Date(guess), tz);
  const utc = guess - offset;
  // One more pass in case the offset changed across a DST boundary.
  const offset2 = zoneOffsetMs(new Date(utc), tz);
  return new Date(guess - offset2).toISOString();
}

function zoneOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - date.getTime();
}
