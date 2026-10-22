# AH Solution Blog Draft Pack — 17 Videos

## What's included
- `articles/`: 17 article drafts written in professional English, each linked to the exact original YouTube video URL.
- `blog-manifest.json` / `blog-manifest.csv`: source of truth — title, slug, route, tags,
  keywords, meta descriptions, thumbnail, schema type, word count, reading time, image
  paths and draft status.
- `image-prompts/`: three image briefs per article (cover, listing thumbnail, in-article explainer).
- `assets/`: 51 generated editorial SVGs (cover 1200x630, thumbnail 640x360, explainer 1200x800).
- `schema/`: BlogPosting + VideoObject structured-data template and notes.
- `ARTICLE-FORMAT.md`: the canonical draft format (structure, sections, links, accuracy rules).
- `EDITORIAL-QUEUE.md`: per-article review queue with status.
- `IMPORT.md`: how to preview, import as drafts, and publish — read this before going live.

## Status
All 17 entries stay **DRAFT FOR REVIEW** in the CMS manifest (`publish_status = draft`,
`canonical_url = SET_ONLY_AFTER_PUBLISHING`). On top of that, `scripts/blog-build.js`
renders them as public, indexable pages at `article/<slug>/`, lists all 17 on the public
`blog.html`, and adds them to `sitemap.xml`. Those files are committed to the repo and go
live only when the site is deployed — nothing has been deployed or verified live yet.
Going live still needs an explicit deploy step and a human pass over the pre-publish
checklist (image rights, a real 1200x630 `og:image`).

## Tooling (dependency-free)
```bash
npm run blog:build     # generate public article pages + inject the blog.html listing + sitemap
npm run blog:sync      # rebuild blog-manifest.json/.csv + EDITORIAL-QUEUE.md
npm run blog:import    # dry run of the CMS import (drafts only; never publishes)
npm run qa:blog        # full blog QA (content, links, public pages, JSON-LD, browser pass)
npm start              # local static server on http://localhost:8000
```
`npm run blog:build` is idempotent: it rewrites `article/<slug>/index.html` for every
manifest record, replaces the region between the `BLOG:ARTICLES:START/END` markers in
`blog.html`, and the matching markers in `sitemap.xml`. Each generated page is indexable,
carries `canonical`/`og:url = https://ahsolution.live/article/<slug>/`, links back to
`/blog.html`, and embeds the source YouTube video. Serve over HTTP (root-relative paths),
not `file://`.

## Image handling
Drafts reference the original CSV thumbnail for context. Assets in `assets/` are original
generated SVG graphics, not screenshots and not the video thumbnails. Before publishing,
rasterise the cover to a 1200x630 JPEG/PNG for `og:image` (social crawlers do not render
SVG) and confirm you have the rights to any image you ship.

## Editorial caution
The source data includes titles, descriptions and metadata, but not a transcript for every
video. Drafts preserve the original video links and avoid inventing demonstrations or app
names that were not in the source. Before publication, watch the source video and verify
model-specific specifications, current app workflows, legal/safety details and any
time-sensitive claims.

## Workflow
1. Review each article against the source video (`EDITORIAL-QUEUE.md`).
2. Commission/rasterise final images; keep briefs in `image-prompts/` as the spec.
3. Edit the Markdown, then `npm run blog:build` to refresh the public pages, listing
   and sitemap; confirm rendering, canonical URL, video embed, mobile layout and
   structured data locally (`npm start`).
4. Deploy only after approval, then verify the live URLs.
   The CMS import path (`IMPORT.md`) remains available for editing the same drafts.
