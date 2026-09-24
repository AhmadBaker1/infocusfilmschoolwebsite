// Job postings (copied from infocusfilmschool.com/jobs, 2026-09-24). Add,
// edit or remove roles in src/data/jobs.json; each gets a page at
// /careers/<id> and an application page at /careers/<id>/apply.
import data from '../data/jobs.json';

export type Job = (typeof data)[number];

export const jobs: Job[] = data;

export const DEPTS: Record<string, string> = {
  leadership: 'Leadership',
  admissions: 'Admissions + Finance',
  faculty: 'Faculty',
  marketing: 'Marketing',
};

export const EMAIL = 'info@infocusfilmschool.com';
export const GENERAL = 'General application';

const strip = (h: string) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Split a posting into sections keyed by its bold one-line headings. */
function sections(html: string) {
  const out: { title: string; html: string }[] = [];
  const re = /<p>\s*<strong>([^<]{2,80})<\/strong>\s*<\/p>/g;
  let m: RegExpExecArray | null;
  const marks: { title: string; start: number; end: number }[] = [];
  while ((m = re.exec(html))) marks.push({ title: m[1].replace(/:\s*$/, '').trim(), start: m.index, end: re.lastIndex });
  marks.forEach((mk, i) => out.push({ title: mk.title, html: html.slice(mk.end, marks[i + 1]?.start ?? html.length) }));
  return out;
}

/** Short summary + requirements for the application page's side panel. */
export function summarize(job: Job): { about: string; lookingFor: string[] } {
  const secs = sections(job.html);
  const aboutSec = secs.find((s) => /about the role|position overview|role overview/i.test(s.title));
  const firstP = (h: string) => strip(h.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? '');
  let about = aboutSec ? firstP(aboutSec.html) : '';
  if (!about) {
    // Fall back to the first substantial paragraph in the posting.
    about = [...job.html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((x) => strip(x[1])).find((t) => t.length > 120) ?? '';
  }
  if (about.length > 320) about = about.slice(0, 317).replace(/\s+\S*$/, '') + '…';

  const lookSec = secs.find((s) => /looking for|qualifications|requirements/i.test(s.title));
  const lookingFor = lookSec
    ? [...lookSec.html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => strip(x[1])).filter(Boolean).slice(0, 5)
    : [];
  return { about, lookingFor };
}
