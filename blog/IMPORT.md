# Blog draft import, review and publishing

This document covers the 17 drafts in `blog/articles/`: how they are
built into public pages, how to review them locally, how to import them into the
CMS **as drafts**, and how a human publishes later. Nothing here deploys
anything automatically.

Public pages are generated straight from the Markdown + manifest by
`scripts/blog-build.js` (see section 2); the CMS import below is the parallel
path for editing the same drafts in the admin panel.

Status of every record: `publish_status = draft`, `status = draft_for_review`,
`editorial_verification_status = pending`, `canonical_url = SET_ONLY_AFTER_PUBLISHING`.
`qa:blog` fails the build if any of that changes.

---

## 1. Prerequisites

- Node 18+ (repo tested on Node 24).
- For a local review: nothing else — the preview build and the static server are
  dependency-free (`scripts/serve.cjs`).
- For `--live --direct`: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
  (service key — server/CLI only, never in front-end code, never committed).
- For `--live --endpoint`: a signed-in admin user's JWT and the deployed
  `/.netlify/functions/articles` URL.

Credentials are read from the environment, never written to disk or printed.
Keep them in your shell or a local `.env` that is gitignored (`.env` is ignored
by this repo — never commit it).

---

## 2. Build + review locally

```bash
npm run blog:build       # generate public article pages, the blog listing + sitemap
npm start                # static server on http://localhost:8000
```

Then open `http://localhost:8000/blog.html` (the full listing) and any article at
`http://localhost:8000/article/<slug>/`.

- `scripts/blog-build.js` writes an indexable page for every manifest record to
  `article/<slug>/index.html`, injects the 17 cards into the `BLOG:ARTICLES:START/END`
  region of `blog.html`, and adds the article URLs to the matching region of
  `sitemap.xml`.
- Each generated page carries `canonical`/`og:url = https://ahsolution.live/article/<slug>/`,
  one H1, the YouTube embed, TOC, FAQ, and a back-link to `/blog.html`. It is a real
  public file (committed to the repo) and goes live only when the site is deployed.
- Open it through the HTTP server, not `file://` — the pages use root-relative
  `/assets/...` paths.

Useful while editing an article: re-run `npm run blog:build` (idempotent) and
refresh; use `npm run qa:blog` to re-validate everything.

---

## 3. Import as drafts

Always start with the dry run — it makes no network calls and writes nothing:

```bash
npm run blog:import
```

It prints the record count (17), total words, every slug + eventual route, and
the payload keys. (The public build already writes the matching sitemap lines —
see section 2.)
Use `--slug=<slug>` to target one article:

```bash
node scripts/blog-import-drafts.cjs --slug=iqoo-z5-5g-unboxing-first-look
```

### Option A — direct (service role)

```bash
node scripts/blog-import-drafts.cjs --live --direct
```

- Writes through the Supabase REST API using the service-role key.
- Idempotent: matched by `slug`; existing drafts are updated in place, never
  duplicated, and never flipped to published.
- `status` is hard-locked to `draft` in code; there is no publish flag.

### Option B — through the admin API

```bash
node scripts/blog-import-drafts.cjs --live \
  --endpoint https://ahsolution.live/.netlify/functions/articles \
  --token <admin-user-jwt>
```

- Uses the same endpoint the admin panel uses, so all server-side validation
  applies (admin allowlist, slug checks, HTML sanitiser).
- The server sanitiser keeps exactly one kind of embed — the YouTube player
  (`www.youtube.com/embed/...` and `www.youtube-nocookie.com/embed/...`). Every
  other `<iframe>`, `<script>`, `<style>` and inline event handler is stripped.
  Our generated bodies only contain that one allowed embed, so the video
  survives import and any later admin re-save.

Both modes are safe to re-run.

---

## 4. Before publishing (human checklist)

1. Watch the source video and verify every model-specific claim, app flow,
   price, and any time-sensitive or legal/safety statement. The drafts were
   written from titles/metadata, not transcripts.
2. Clear image rights. Replace the generated SVGs with final raster assets:
   - `og:image` / social cards must be **JPEG or PNG, 1200x630** — most social
     crawlers do not render SVG. Rasterise the cover before publishing.
   - Keep the listing thumbnail and in-article explainer consistent with the
     briefs in `blog/image-prompts/`.
   - Do not present generated artwork as a screenshot or as the original video
     thumbnail.
3. Update the record in `blog-manifest.json` if any slug, title, meta or image
   path changed, and re-run `npm run blog:sync`.
4. Re-run `npm run qa:blog` and confirm it is green.

---

## 5. Publishing (making an article public)

The public pages already exist after `npm run blog:build` (section 2): each article
is a real file at `article/<slug>/index.html` with `canonical`/`og:url`
`https://ahsolution.live/article/<slug>/`, listed on `blog.html` and in `sitemap.xml`.
`netlify.toml` also rewrites `/article/<slug>/` → `/article.html?slug=<slug>` (status 200)
as a fallback. They go live when the site is deployed — a human-approved step.

If you want the CMS to own an article as well, publish it in the admin panel:

1. Open the draft and set its status to **published** (or `status='published'` +
   `published_at` via the CMS API as an authenticated admin — never via this pack's
   import script, which refuses to publish).
2. Set `canonical_url = https://ahsolution.live/article/<slug>/` in `blog-manifest.json`
   (replace `SET_ONLY_AFTER_PUBLISHING`) so the CMS record and the static page agree.
3. Re-run `npm run blog:build` and `npm run qa:blog`.

### Rollback

For the CMS path, set the article back to `draft` (or `archived`); drafts are
invisible to the public read path (RLS). For the static path, remove the article
from the manifest (or set it aside), re-run `npm run blog:build`, and redeploy.

---

## 6. What is intentionally NOT done by this pack

- No Netlify deploy, no Git commit/push, no DNS/domain changes.
- No CMS publish — the manifest records stay `publish_status = draft`.
- No images uploaded anywhere; assets are local SVGs (WebP/AVIF rasterisation
  pending — no rasteriser available in this environment).
- No claims invented to fill gaps; each draft keeps its original video link and
  an explicit "verification pending" note.

---

## 7. QA commands

```bash
npm run qa:blog      # blog package: content, metadata, links, public pages,
                     # JSON-LD, site safety, import dry-run + a headless browser
                     # pass (server + Chromium are started/used automatically)
npm run qa           # the full site suite (device, pages, scroll, ai, admin);
                     # needs a server: run `npm start` in another terminal first
```

`qa:blog` does not need a pre-started server; it launches `scripts/serve.cjs`
itself on a throwaway port.
