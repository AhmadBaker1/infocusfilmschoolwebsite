// Server-side HTML allowlist for content written in the rich editor
// (job postings, events). Workers have no DOM, so this is a tag tokenizer:
// unknown tags are dropped (their text stays), every attribute is dropped
// except a safe href, and headings are canonicalised to the
// <p><strong>Heading</strong></p> form the public pages and summarize() use.

const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3']);
const RENAME: Record<string, string> = { b: 'strong', i: 'em', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', div: 'p' };

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export interface SanitizeOptions {
  /* Keep <h2>/<h3> as real headings (blog articles) instead of the bold-paragraph storage form. */
  keepHeadings?: boolean;
}

export function sanitizeHtml(input: string, opts: SanitizeOptions = {}): string {
  let s = input.replace(/\r\n/g, '\n');
  s = s.replace(/<(script|style|iframe|object|embed|svg|math|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, rawTag: string, attrs: string) => {
    const closing = m.startsWith('</');
    const tag = RENAME[rawTag.toLowerCase()] ?? rawTag.toLowerCase();
    if (!ALLOWED.has(tag)) return '';
    if (tag === 'br') return closing ? '' : '<br/>';
    if (closing) return `</${tag}>`;
    if (tag === 'a') {
      const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const url = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim();
      const safe = /^(https?:\/\/|mailto:|\/(?!\/))/i.test(url) ? url : '';
      return safe ? `<a href="${escapeAttr(safe)}" rel="noopener">` : '<a>';
    }
    return `<${tag}>`;
  });

  // Headings -> bold paragraphs (the storage form for postings and events).
  // Nested inline tags inside a heading are flattened either way.
  s = s.replace(/<(h[23])>([\s\S]*?)<\/h[23]>/g, (_, tag: string, t: string) => {
    const text = t.replace(/<\/?(strong|em|u|a)[^>]*>/g, '').replace(/<br\/>/g, ' ').trim();
    if (!text) return '';
    return opts.keepHeadings ? `<${tag}>${text}</${tag}>` : `<p><strong>${text}</strong></p>`;
  });

  s = s.replace(/<a>([\s\S]*?)<\/a>/g, '$1'); // links without a safe href
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/<(p|li)>(\s|<br\/>)*<\/\1>/g, ''); // empty blocks
  s = s.replace(/<(ul|ol)>\s*<\/\1>/g, '');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Storage form -> editing form: bold-only paragraphs become real headings. */
export function editableHtml(html: string): string {
  return html.replace(/<p>\s*<strong>([^<]{1,200})<\/strong>\s*<\/p>/g, '<h2>$1</h2>');
}
