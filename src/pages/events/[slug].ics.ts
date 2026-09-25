// GET /events/<slug>.ics: the event as an iCalendar file (Add to calendar).
import type { APIRoute } from 'astro';
import { db } from '../../lib/server/db';
import { getBySlug } from '../../lib/server/events';

export const prerender = false;

// RFC 5545: escape text, CRLF line ends, fold lines longer than 75 octets.
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export const GET: APIRoute = async (ctx) => {
  const ev = await getBySlug(db(ctx.locals), ctx.params.slug!, { publishedOnly: true });
  if (!ev) return new Response(null, { status: 404 });

  const url = new URL(`/events/${ev.slug}`, ctx.site ?? ctx.url.origin).toString();
  // No end time: assume two hours so calendars show a block rather than a dot.
  const end = ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + 2 * 3600 * 1000).toISOString();
  const description = [ev.summary, url].filter(Boolean).join('\n\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//InFocus Film School//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:event-${ev.id}@infocusfilmschool.com`,
    `DTSTAMP:${stamp(ev.updated_at)}`,
    `DTSTART:${stamp(ev.starts_at)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    `DESCRIPTION:${esc(description)}`,
    ev.location ? `LOCATION:${esc(ev.location)}` : null,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((l): l is string => l !== null);

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${ev.slug}.ics"`,
      'cache-control': 'public, max-age=60',
    },
  });
};
