// Tiny Markdown <-> HTML for admin-authored content (events, job postings).
// Deliberately small: headings, paragraphs, bold/italic, links, lists,
// line breaks. Input is escaped first, so the output is safe to set:html.
//
// Headings render as <p><strong>Heading</strong></p>, which is what the
// original job postings use and what src/lib/jobs.ts `summarize()` parses.
import { escapeHtml } from './http';

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/  \n/g, '<br/>');
}

export function mdToHtml(md: string): string {
  const lines = escapeHtml(md.replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: 'ul' | 'ol' | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br/>\n')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^#{1,6}\s+(.+)$/);
    const ul = line.match(/^\s*[-*]\s+(.+)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      out.push(`<p><strong>${inline(h[1].trim())}</strong></p>`);
    } else if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        flushList();
        list = kind;
        out.push(`<${kind}>`);
      }
      out.push(`<li>${inline((ul ?? ol)![1].trim())}</li>`);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&#8211;/g, '–');
}

/** Rough reverse for editing the seeded HTML postings. Good enough for p/strong/em/a/ul/ol/li/br. */
export function htmlToMd(html: string): string {
  let s = html.replace(/\r\n/g, '\n');
  // Heading paragraphs: <p><strong>Title</strong></p>
  s = s.replace(/<p>\s*<strong>([^<]{1,120})<\/strong>\s*<\/p>/gi, (_, t) => `\n## ${t.trim()}\n`);
  s = s.replace(/<br\s*\/?>\s*\n?/gi, '  \n');
  s = s.replace(/<(ul|ol)>/gi, '\n').replace(/<\/(ul|ol)>/gi, '\n');
  s = s.replace(/<li>([\s\S]*?)<\/li>/gi, (_, t) => `- ${t.trim()}\n`);
  s = s.replace(/<p>([\s\S]*?)<\/p>/gi, (_, t) => `\n${t.trim()}\n`);
  s = s.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**').replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
  s = s.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*').replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');
  s = s.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  // Keep list items adjacent: a blank line between "- " lines would split the
  // list into one <ul> per item when it comes back through mdToHtml.
  s = s.replace(/^(- .*)\n\n+(?=- )/gm, '$1\n');
  return s.trim();
}
