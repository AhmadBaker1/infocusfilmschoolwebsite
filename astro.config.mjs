// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import requireCredit from './integrations/require-credit.mjs';

export default defineConfig({
  site: 'https://infocusfilmschool.com',
  // Marketing pages stay static. Anything with `export const prerender =
  // false` (admin, login, APIs, events, careers) renders on Cloudflare
  // Workers with the D1 database and R2 bucket from wrangler.jsonc.
  output: 'static',
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: 'compile',
  }),
  // Fails the build if any page is missing the site credit.
  integrations: [requireCredit()],
  // Old WordPress URLs that moved.
  redirects: {
    '/jobs': '/careers',
    '/film-production': '/programs/film-production',
    '/3d-animation-intensive-program': '/programs/3d-animation-intensive',
    '/game-design-program': '/programs/game-design',
    '/visual-effects-compositing-program': '/programs/visual-effects-compositing',
    '/graphic-design-program': '/programs/graphic-digital-design',
    '/cinematography-program': '/programs/cinematography-intensive',
    '/documentary-film-program': '/programs/documentary-film',
    '/writing-film-television-program': '/programs/writing-for-film-tv',
    '/acting': '/programs/acting-program',
    '/standardized-traffic-control-training': '/programs/standardized-traffic-control-training',
    '/film-production/yorkville-university-pathway': '/programs/yorkville-university-pathway',
  },
});
