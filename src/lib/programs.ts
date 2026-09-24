// Program pages are data-driven: one JSON file per program in
// src/data/programs/, rendered by src/pages/programs/[slug].astro.
// Text fields may contain inline links as [label](href); old-site URLs are
// rewritten to their new homes by `renderInline`.

export type Link = { label: string; href: string };

export type Program = {
  slug: string;
  /* Old WordPress path, redirected to /programs/<slug>. */
  oldPath: string;
  title: string;
  /* Short name for cards and menus. */
  shortTitle: string;
  group: 'film' | 'animation';
  /* One-line summary for cards and the page description. */
  summary: string;
  hero: { image?: string; imageAlt?: string };
  intro: { heading: string; paras: string[] };
  facts: { label: string; value: string }[];
  about: { heading: string; cards: { title: string; text: string; link?: Link }[] };
  /* Free-form feature sections, in page order. */
  sections: { heading: string; paras: string[]; image?: string; imageAlt?: string; link?: Link }[];
  curriculum?: { heading: string; intro?: string; software?: string[]; modules: { title: string; text: string }[] };
  stats?: { heading?: string; text?: string; items: { value: string; label: string }[]; source?: Link };
  /* Graduate cards: portrait, name, program, and what they've done. */
  alumni?: {
    name: string;
    image: string;
    program: string;
    label: string;
    credits: { text: string; winner?: boolean }[];
  }[];
  pathway?: { heading: string; text: string; link: Link };
  costs?: {
    heading: string;
    text: string;
    domestic: string;
    international: string;
    notes?: string[];
    breakdown?: string;
  };
  accreditation?: { heading: string; paras: string[] };
  details: { label: string; text: string }[];
  startDates?: string;
  requirements?: { intro: string; items: string[] };
  links: { apply?: string; studentWork?: string; curriculum?: string };
};

// Old-site links that now have a home here.
const LINK_MAP: [RegExp, string][] = [
  [/^https?:\/\/infocusfilmschool\.com\/policies\/?.*$/, '/policies'],
  [/^https?:\/\/infocusfilmschool\.com\/film-production\/yorkville-university-pathway\/?$/, '/programs/yorkville-university-pathway'],
  [/^https?:\/\/infocusfilmschool\.com\/wp-content\/uploads\/.*EquipmentFacilit.*\.pdf$/, '/facilities'],
  [/^https?:\/\/infocusfilmschool\.com\/privacy-policy\/?$/, '/privacy'],
];

export function mapHref(href: string): string {
  for (const [re, to] of LINK_MAP) if (re.test(href)) return to;
  return href;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escape text and turn [label](href) into links. */
export function renderInline(text: string): string {
  return esc(text).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const to = mapHref(href);
    const ext = /^https?:\/\//.test(to);
    return `<a href="${to}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
}

const files = import.meta.glob<Program>('../data/programs/*.json', { eager: true, import: 'default' });

/** All programs in menu order. */
export const PROGRAM_ORDER = [
  'film-production',
  'cinematography-intensive',
  'documentary-film',
  'writing-for-film-tv',
  'acting-program',
  '3d-animation-intensive',
  'visual-effects-compositing',
  'game-design',
  'graphic-digital-design',
];

export function getPrograms(): Program[] {
  const all = Object.values(files);
  return all.sort((a, b) => {
    const ia = PROGRAM_ORDER.indexOf(a.slug);
    const ib = PROGRAM_ORDER.indexOf(b.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}
