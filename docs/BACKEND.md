# InFocus staff backend

The public site stays static. The staff area (`/admin`), sign-in (`/login`),
the APIs (`/api/*`) and the pages that read from the database (`/events`,
`/careers`) render on demand on Cloudflare Workers.

| Piece | Where | Cloudflare product (free plan) |
| --- | --- | --- |
| Site + server routes | `dist/` via `@astrojs/cloudflare` | Workers + static assets |
| Database | `migrations/*.sql`, binding `DB` | D1 (SQLite) |
| Files (résumés, event images) | binding `FILES` | R2 |
| Secrets | `SESSION_SECRET` | Worker secrets |

## Roles

Accounts are created by a super admin under **Staff accounts**. Nobody can
self-register and there is no sign-in button on the site: share
`https://infocusfilmschool.com/login` privately.

| Role | Sections |
| --- | --- |
| `admin` | Everything, plus staff accounts |
| `marketing` | Events, blog, and Apply Now submissions (admissions) |
| `hr` | Job postings, applicants, talent pool, résumé downloads |
| `admissions` | Apply Now submissions |

A person can hold several roles. Which roles open which section is the
`SECTIONS` table in `src/lib/server/auth.ts`; `src/middleware.ts` enforces it.

## Writing content

Job postings, events and articles use the rich text editor
(`src/components/admin/RichEditor.astro`): a toolbar for headings, bold,
italic, lists and links; pasting from Word or Google Docs is cleaned up;
and **Import from a document** reads a PDF, Word (.docx) or text file in
the browser and turns its headings, bullets and paragraphs into content
(scanned PDFs have no text and are refused with a message). The server
re-sanitizes everything (`src/lib/server/sanitize.ts`) before storing.
Postings and events store section headings as bold paragraphs, which is
what the public pages and the application-page summary expect; articles
keep real headings for their table of contents.

## Security notes

- Passwords: PBKDF2-SHA256 (100k iterations, per-user salt) then HMAC with
  `SESSION_SECRET`, so a leaked database alone is not enough to crack them.
  Minimum 12 characters.
- Sessions: random token in an `HttpOnly; Secure; SameSite=Lax` cookie; only
  its SHA-256 is stored; 12-hour expiry; revocable per user.
- Sign-in throttling: 8 failed attempts per email or IP per 15 minutes.
- Invites and password resets are one-time links valid 72 hours; nothing is
  emailed automatically, the admin copies the link.
- Private responses send `Cache-Control: no-store`, `X-Robots-Tag: noindex`
  and `X-Frame-Options: DENY`; `robots.txt` also disallows `/admin`, `/login`
  and `/api/`.
- Public forms: server-side validation, honeypot field, 5 submissions per IP
  per hour, file type and size checks, files stored under random ids.
- Every change is written to `audit_log` (who, what, when).

## Local development

```sh
npm install
echo SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))") > .dev.vars
npm run db:migrate                                   # local D1 (in .wrangler/state)
npm run admin:invite -- you@infocusfilmschool.com "Your Name"
npm run dev                                          # http://localhost:4321
```

Open the printed `/login/setup?token=...` link, set a password, sign in at
`/login`.

## First deploy

1. `npx wrangler login`
2. `npx wrangler d1 create infocus` and paste the printed `database_id` into
   `wrangler.jsonc`.
3. `npx wrangler r2 bucket create infocus-files`
4. `npx wrangler secret put SESSION_SECRET` (paste a long random string).
5. `npm run db:migrate:remote`
6. `npm run deploy` (builds, then `wrangler deploy`).
7. `npm run admin:invite -- you@infocusfilmschool.com "Your Name" --remote`
   and open the link on the live site.
8. In the Cloudflare dashboard, add the custom domain
   (Workers & Pages → the worker → Settings → Domains & Routes) and point DNS
   at it.

Later deploys: `npm run deploy`. New migrations: add
`migrations/000N_name.sql`, then `npm run db:migrate:remote`.

## Initial staff (agreed 2026-09-25)

Run once against production after the first deploy (drop `--remote` to do
the same on the local database). Each prints a one-time setup link to send
to that person.

```sh
npm run admin:invite -- ahmad.baker@mcgcollege.com "Ahmad Baker" --remote
npm run admin:invite -- dj.gupta@mcgcollege.com "DJ Gupta" --remote
npm run admin:invite -- dmetri.berko@mcgcollege.com "Dmetri Berko" --remote
npm run admin:invite -- marketing@infocusfilmschool.com "Marketing" --roles marketing --remote
npm run admin:invite -- nada@infocusfilmschool.com "Nada" --roles hr --remote
```

Super admins can add or change anyone afterwards under Staff accounts.

## Where things are

```
src/middleware.ts            session loading, role gates, private headers
src/lib/server/auth.ts       hashing, sessions, invites, throttling
src/lib/server/db.ts         D1 helpers + audit()
src/lib/server/http.ts       json/redirect/flash/validation helpers
src/lib/server/markdown.ts   markdown <-> html for events and postings
src/lib/format.ts            dates in Mountain Time (Calgary)
src/layouts/Admin.astro      staff frame (sidebar, header, flash)
src/styles/admin.css         staff design system
src/pages/login/             sign in, account setup
src/pages/admin/             dashboard, events, jobs, applicants, admissions, users
src/pages/api/auth/          login, logout, setup
src/pages/api/admin/         staff actions (POST forms with _action)
src/pages/api/apply/         public job + admissions form endpoints
src/pages/files/events/      public event images from R2
src/pages/admin/files/       private résumé downloads (HR)
scripts/invite-admin.mjs     bootstrap the first super admin
scripts/seed-jobs.mjs        regenerate migrations/0002_seed_jobs.sql
```

Times are stored as UTC and shown in Mountain Time (`America/Edmonton`).
