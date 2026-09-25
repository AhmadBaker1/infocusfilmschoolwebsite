// Build guard: every generated HTML page must carry the site credit
// ("Made by Ahmad Baker", linking to his LinkedIn). If any page is missing it,
// `astro build` fails and lists the pages. Redirect stubs are skipped.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HREF = 'https://www.linkedin.com/in/ahmadbaker/';
const TEXT = 'Ahmad Baker';

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(p)));
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

export default function requireCredit() {
  return {
    name: 'require-credit',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const missing = [];
        for (const file of await htmlFiles(root)) {
          const html = await readFile(file, 'utf8');
          // Redirect stubs are tiny meta-refresh pages, not real pages.
          if (/http-equiv="refresh"/i.test(html) && html.length < 2000) continue;
          if (!html.includes(HREF) || !html.includes(TEXT) || !html.includes('data-site-credit')) {
            missing.push(file.slice(root.length));
          }
        }
        if (missing.length) {
          throw new Error(
            `Site credit ("Made by ${TEXT}") is missing from ${missing.length} page(s):\n  ` +
              missing.join('\n  ') +
              '\nEvery page must render <SiteCredit /> via src/layouts/Base.astro.'
          );
        }
        logger.info('Site credit present on every page.');
      },
    },
  };
}
