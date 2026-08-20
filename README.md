# InFocus Film School

Astro static site. Currently: the homepage hero.

## Run

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # -> dist/
npm run preview
```

## Structure

```
src/
  layouts/Base.astro       shell, fonts, theme boot + toggle script
  components/Nav.astro     top bar (links / wordmark / utilities)
  components/Hero.astro    3-image band + headline + intro + CTA
  styles/global.css        design tokens (colours, gutters, type)
public/images/             hero art
```

## Swapping the hero images

`public/images/hero-1..3.svg` are placeholders. Drop in real photos and update the
`panels` array at the top of [Hero.astro](src/components/Hero.astro). Panels are
cropped to a 529:657 portrait ratio (`object-fit: cover`), so source images want to
be portrait and at least ~1060px wide. Update `width`/`height` on the `<img>` to the
real intrinsic dimensions.

## Editing hero copy

Headline lines live directly in `Hero.astro`'s `<h1>`. `<em>` renders the serif
italic; everything else is the grotesk. The intro paragraph is the `intro` const.

## About section

White background, charcoal text (the guide's "grey logo + text" pairing), Oswald
heading with the brand-red underline. Copy left, photo collage right.

The collage is six absolutely-positioned cards inside a square box — percentage
`left`/`top`/`width` per card, `z-index` increasing down the stack so the cluster reads
as layered. Cards are axis-aligned by design: overlapping, never rotated or skewed.
Each carries a 6px white keyline, without which the darker frames merge into each other
against the white background.

Cards 2, 4 and 6 deliberately extend past the box (`x + w > 100`) and are clipped by
`overflow: hidden` on the section, so the cluster bleeds off the page edge rather than
sitting neatly inside a column. Keep that `overflow: hidden` — without it the cards
push the page wider instead of being cut.

Breakpoints: two columns → one at 1000px; below 700px the overlap has no room, so the
cards drop out of absolute positioning into a plain 2-column grid.

## Photos

`public/images/about-1..6.jpg` are web derivatives (1200px, ~580KB for all six).
Originals live in `source-photos/`, outside `public/`, so they are never deployed —
that directory holds a 24MB `.CR2` that would otherwise ship to every visitor.

`about-6.jpg` is converted from `IMG_4417.CR2`; browsers cannot display Canon RAW.
`IMG_9715` is unused — it is a near-duplicate of `IMG_9714`.

Note `source-photos/` is not gitignored, so committing it puts ~29MB into git history.
Worth deciding on git-lfs or an ignore rule before the first commit.

## Hero load animation

Pure CSS in `Hero.astro`, no JS. Panels wipe upward via `clip-path` while the photo
inside settles out of a 1.14 push-in; the headline lines and the aside then rise on a
stagger. Timings run 0.15s → 0.99s of delay.

Two things to preserve if you touch it:

- Every animation uses `both` fill-mode. Without it, staggered elements paint in their
  final position during the delay and then snap back to the start — a visible flash.
- `prefers-reduced-motion` sets `animation: none` rather than a near-zero duration, so
  the hero renders normally instead of racing through the sequence.

## Brand assets

Supplied artwork lives in `public/images/` (`IF-*.png` / `IF-Logo-Social.jpg`) and is
kept untouched as the source of truth. Two things are derived from it:

- `logo-on-dark.png` / `logo-on-light.png` — the wordmark cropped to its ink box.
  Both come out at ratio 2.795, so the nav's light/dark swap never shifts size or
  position. Regenerate by re-cropping to the alpha bounding box if the source changes.
- `public/favicon*.png`, `apple-touch-icon.png` — redrawn from the icon mark's measured
  geometry (8.8% stroke, dot at 30.2%/30.7% with 11.6% radius, `#333333` / `#bd2f2f`)
  rather than downscaled, so the thin outline stays crisp at 32px. `favicon.svg` is the
  same geometry as vector.

Favicons sit on an opaque white tile so the dark mark stays visible against both light
and dark browser chrome, matching `IF-Logo-Social.jpg`. That file is also the `og:image`.

## Theme

Dark is the default. The nav's Dark Mode switch flips `data-theme` on `<html>` and
persists to `localStorage`; light values are the `:root[data-theme='light']` block in
`global.css`. An inline script in `Base.astro` applies the stored choice before paint
so there is no flash.

## Type and colour

Per the brand guide:

- **Headings + UI labels** — Oswald, uppercase, left-justified.
- **Body** — Avenir (Book/Roman). Avenir is an Apple system face and can't be
  self-hosted, so the stack is `'Avenir Next', 'Avenir', 'Open Sans Variable'` —
  Open Sans is the guide's designated web fallback and is self-hosted.
- **Palette** — tokens in `global.css`: charcoal `#333333`, red `#bd2f2f`,
  white `#ffffff`, grey `#e1e1e1`, blue `#224466`.

Two deliberate departures from the guide, both by request:

- The guide avoids black in favour of charcoal; the hero background is black
  (`--bg: var(--black)`). `--charcoal` remains defined for later sections.
- The guide calls for an underline on primary headings "where appropriate" — the
  hero display slogan doesn't carry one. Add it on inner-page `h1`s.

When writing the name in body copy it is "InFocus" — capital I and F, no space.
