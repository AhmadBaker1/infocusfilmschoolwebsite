-- Marketing: blog articles. Moved out of src/content/blog Markdown files so
-- staff can write and publish from the staff area. Bodies are stored as the
-- sanitised HTML the rich editor produces; headings are real <h2>/<h3>.

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,             -- article URL: /<slug>/ (kept from WordPress)
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',      -- card text + meta description
  category TEXT NOT NULL DEFAULT 'howto' CHECK (category IN ('howto', 'industry', 'success')),
  author TEXT NOT NULL DEFAULT '',
  cover_key TEXT,                        -- R2 key under blog/ (uploads from the staff area)
  cover_url TEXT,                        -- site path for the covers that ship with the site (/images/blog/...)
  cover_alt TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TEXT,                     -- ISO UTC; the public date. NULL until first published.
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX posts_status_published ON posts(status, published_at);
