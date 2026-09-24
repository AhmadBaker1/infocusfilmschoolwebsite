import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

export const CATEGORIES = {
  howto: 'Guides + How-Tos',
  industry: 'Understanding the Industry',
  success: 'Student Success',
} as const;

export type PostCard = {
  slug: string;
  href: string;
  title: string;
  description: string;
  category: keyof typeof CATEGORIES;
  categoryLabel: string;
  author?: string;
  date: Date;
  dateText: string;
  minutes: number;
  /* First photo inside the article. The old covers are title cards (one
     misspelt), so they're only a share image, never a thumbnail. */
  image?: string;
  imageAlt: string;
};

const WORDS_PER_MINUTE = 230;

export const formatDate = (d: Date) =>
  d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function toCard(post: Post): PostCard {
  const body = post.body ?? '';
  // First <img> in the Markdown that isn't an animated GIF.
  const img = [...body.matchAll(/<img src="([^"]+)" alt="([^"]*)"/g)].find((m) => !m[1].endsWith('.gif'));
  return {
    slug: post.id,
    href: `/${post.id}/`,
    title: post.data.title,
    description: post.data.description,
    category: post.data.category,
    categoryLabel: CATEGORIES[post.data.category],
    author: post.data.author,
    date: post.data.date,
    dateText: formatDate(post.data.date),
    minutes: Math.max(1, Math.round(body.split(/\s+/).length / WORDS_PER_MINUTE)),
    image: img?.[1],
    imageAlt: img?.[2] ?? '',
  };
}

/** All posts, newest first. */
export async function getPosts(): Promise<Post[]> {
  return (await getCollection('blog')).sort((a, b) => +b.data.date - +a.data.date);
}
