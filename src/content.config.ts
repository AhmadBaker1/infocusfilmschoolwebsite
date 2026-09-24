import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Blog posts, one Markdown file each in src/content/blog. The file name is the
// URL slug, kept identical to the old WordPress site so existing links and
// search results keep working (e.g. /how-to-use-lenses-in-film/).
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    /* howto = Guides + How-Tos, industry = Understanding the Industry,
       success = Student Success stories */
    category: z.enum(['howto', 'industry', 'success']),
    author: z.string().optional(),
    /* Social share image. The old covers are title cards, so they're not
       shown on the page itself. */
    cover: z.string().optional(),
    coverAlt: z.string().optional(),
  }),
});

export const collections = { blog };
