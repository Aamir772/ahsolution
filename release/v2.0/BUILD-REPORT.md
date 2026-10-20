# AH Solution V2.0 — Build Report

**Build outcome: PASS.** All suites and all release-directory checks ran and passed with zero failures. Production-ready artifact created. **Nothing was deployed, committed, or overwritten** — the live site is untouched.

## Source & output paths

- Source project: `F:\AI Project\AH Solution` (branch `master`, commit `83036f8` + QA-verified working tree)
- Deployment folder: `F:\AI Project\AH Solution\release\v2.0\site` (142 files, self-contained)
- Archive: `F:\AI Project\AH Solution\release\v2.0\AH-Solution-v2.0-Netlify.zip`
- Release manifest: `F:\AI Project\AH Solution\release\v2.0\RELEASE-MANIFEST.md`

## ZIP fingerprint

- Size: **3,579,552 bytes** (3.42 MB)
- SHA-256: `d3d70a72b100dd7ed7b4c5b79317280e0bbbc7503127f3d57db04ca1d9e7ac74`
- Contents at archive root (no enclosing folder); opens and extracts cleanly; extraction is byte-identical to `site/` (file-by-file SHA-256 comparison)

## ZIP fingerprint (V2.0.1 refresh — live video data, 2026-10-20)

- Size: **3,599,724 bytes** (3.43 MB)
- SHA-256: `8d2f1eaf9a30e61ef45694feaf1b5e7dbb04c1097f959bd32950606228e8578f`
- Changes vs the fingerprint above: `assets/js/main.js` (live-refresh hook + videos-page filter/sort), `assets/css/styles.css` (compact videos-page grid), `vlogs.html` (filter toolbar), `assets/data/videos.json` (re-fetched 2026-10-20 feed), `assets/data/ai-index.json`, refreshed `netlify.toml` in the archive, `_redirects` gained `/api/videos → /.netlify/functions/videos-fresh  200`, `_headers` gained `Cache-Control: public, max-age=300, must-revalidate` for `/assets/data/*.json`.
- The archive is now written with `tar -a -c` (forward-slash entry names; the previous Compress-Archive archive stored backslash paths). Verification: 172 entries, 0 backslash paths, updated markers byte-confirmed inside the zip.
- Note for Drop uploads: `_redirects` maps `/api/videos` to a Netlify Function; on a static Drop (no Functions) that request 404s and the frontend silently keeps the in-bundle snapshot — videos still render with the 2026-10-20 counts, so the page is correct either way.

## Commands executed (all real, all green)

```
npm run blog:sync          → 17 records, no problems
npm run blog:images        → 51 SVG illustrations
npm run blog:build         → 17 PNG covers + 17 article pages + blog cards + sitemap
node scripts/qa-blog.cjs   → 322 passed, 0 failed
node scripts/qa-pages.cjs  → 22/0
node scripts/qa-device.cjs → 27/0
node scripts/qa-scroll.cjs → 33/0
node scripts/qa-admin.cjs  → 80/0
node scripts/ai-qa.cjs     → 74/0
npm run assistant:test     → 165/0 (node --test server/test/*.test.js)
release static verify      → 34/0
release runtime QA (:8010) → 26/0
ZIP verify                 → 9/0
```

## Content counts

- HTML pages: **34** (10 root pages incl. 404 · 17 article routes · 3 guides · 4 admin pages)
- Images: **86** (17 article PNG covers 1200×630 · 51 SVG illustrations · favicons/OG/jpg/deco)
- Articles: **17/17** published, unique slugs/canonicals, BlogPosting + VideoObject JSON-LD, no draft ribbon, no `noindex` in published article heads
- Sitemap: **28 URLs** (11 static + 17 articles), 0 duplicates, accurate `lastmod` (file-derived, date form `2026-10-20` / article dates `2026-10-11`)

## Release-directory verification (beyond source QA)

1. All expected HTML routes exist (✓), 17 articles present & published (✓), 17 covers exist (✓), sitemap correct (✓).
2. Full reference crawl: every local asset referenced in every HTML/CSS/JS resolves inside `site/` (✓).
3. No draft banner / accidental `noindex` in published articles; runtime shell `article.html` keeps its draft-protection `noindex` (✓).
4. Admin pages present; `_headers` enforces `noindex, nofollow` + `no-store` on `/admin/*`; `/article` shell routes carry `noindex` headers (✓).
5. Secrets scan of the entire output: clean. No `F:\…`/`file:///`/user-path leaks. No `node_modules`, `.env`, `.map`, logs, backend sources or ZIPs (✓).
6. 3D JARVIS root + `three.module.min.js` + `globe.js` present; browser QA confirms the intro/boot sequence, 3D visual root, reduced-motion path (via qa-device on source) and zero console errors across a 28-route desktop+mobile sweep (✓).
7. Blog search, category filtering, sorting verified functionally on the release copy (✓).

## Hosting configuration requirements

**For the chosen manual Netlify Drop:** the ZIP contains `_headers` and `_redirects`, which Netlify Drop honours — no other configuration is needed. `netlify.toml` is included but inert in Drop uploads.

**Static-only constraints (important):** a Drop upload ships no Functions. Therefore:
- Admin login/editor actions, AI chat, cover upload and CMS CRUD (`/.netlify/functions/*`) will not operate until the site is also deployed normally (git- or CLI-based) with Functions + env vars. UI pages and redirect entries remain intact and are restored for free by a full deploy later.
- The homepage AI search modal degrades gracefully to local results (expected probe 404 — QA-verified no page errors).

## Manual Netlify deployment instructions

1. Go to https://app.netlify.com/drop
2. Drag `release\v2.0\AH-Solution-v2.0-Netlify.zip` onto the drop area (do not extract; the ZIP is already root-served).
3. When Netlify asks what to do with `ahsolution.live`, choose **Update the existing site** (`ahsolution.live`) — this is the operator's explicit action; this build has not performed it.
4. After deploy, run the post-deployment checks below.

## Post-deployment checks

- `https://ahsolution.live/` — intro animation plays once, JARVIS renders, no console errors
- `https://ahsolution.live/blog.html` — 20 cards, search/chips sort OK
- Pick 3 of 17 articles, e.g. `https://ahsolution.live/article/iqoo-z5-5g-unboxing-first-look/` — headline, canonical, no draft ribbon, cover loads
- `https://ahsolution.live/sitemap.xml` — 28 URLs
- `https://ahsolution.live/robots.txt` — crawls allowed + sitemap line
- Cover URLs, e.g. `https://ahsolution.live/blog/assets/iqoo-z5-5g-unboxing-first-look-cover.png` — 200 for all 17
- `curl -I https://ahsolution.live/admin/login.html` — `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-store`

## Unresolved blockers

- None for the static release. Optional follow-ups (outside this build's mandate): perform the Drop onto the existing site (operator-approved step), and, if dynamic admin/AI features are wanted immediately on the live domain, restore the normal Netlify deploy with Functions and environment variables — then drop uploads are no longer the mechanism (they would replace functions).
- Known cosmetic note: sitemap uses date-only `<lastmod>` (W3C-valid). No drafts, admin pages, schema templates, dev URLs or duplicates included.

## Live video-data update (2026-10-20 — function `videos-fresh`)

Root cause of stale Shorts/counts (confirmed before any change):
1. `assets/data/videos.json` is a **build-time snapshot** (feed of the 15 newest uploads), refreshed only when someone runs `npm run fetch:videos` and redeploys; the shipped snapshot was generated 2026-10-12.
2. `_headers`/`netlify.toml` served `/assets/*` — including that JSON — with `Cache-Control: public, max-age=604800`, so browser **and** CDN could keep a snapshot up to 7 days old on top of the build-time age. Result: visitors could see view counts 1–2 weeks behind YouTube Studio. Shorts classification came from the RSS `/shorts/` URL (evidence-based) and was missing brand-new uploads beyond the 15-item feed window only if >15 newer items existed.

Fixes shipped:
- **New server-side function** `netlify/functions/videos-fresh/videos-fresh.js` (also mounted at `/api/videos` via `netlify.toml` rewrite): fetches the public channel RSS at request time and, when `YT_API_KEY` is configured, enriches it with YouTube Data API statistics/contentDetails. Shorts classification keeps the `/shorts/` URI evidence (duration fallback only for titles that self-claim `#short`). In-process TTL cache (`VIDEOS_CACHE_TTL_SECONDS`, default 900s) protects quota; on upstream failure the last good payload is served (`X-Fresh-Cache: STALE`), with 503 only if there is no cached payload. The API key never appears in any response, log, or error message.
- **Frontend** (`assets/js/main.js`): snapshot renders immediately as before, then one attempt fetches `/api/videos`; a strictly newer `generatedAt` replaces the render, any failure keeps the last successful dataset (never a blank page). Status line badges distinguish `Live channel data` vs `Cached snapshot`.
- **Cache policy**: `/assets/data/*.json` now `Cache-Control: public, max-age=300, must-revalidate` (netlify.toml + release `_headers`); the function response itself carries the same 5-minute policy. Browser re-request after ≤5 min; CDN revalidates; no permanent freeze.
- Manual refresh: intentionally **not** exposed publicly — anonymous visitors can only wait for the ≤15-min TTL cache; refreshing is via redeploy/cron as with the rest of the build pipeline.
- Fresh environment without a key: RSS stats only (verified live 2026-10-20: 15 videos, 2 Shorts, current views like the new `J3Q0LPCas7I` at 1,751). With `YT_API_KEY` set in the Netlify dashboard the same function adds exact API counts/durations with no other change.

Test results for this update (all real runs):
- Function: harness 1 (200 MISS → today's RSS, 15 videos/2 shorts, no key in body, HIT dedupe same `generatedAt`), harness 2 (upstream outage with no cache → 503 JSON; recovery → 200 MISS; outage again inside TTL → 200 with cached payload), harness 3 (`TTL=0` → outage after success → **200 STALE**, 15 videos kept).
- Frontend: live-sync Playwright suite **11/11** — newer `/api/videos` payload re-renders the grid (stub video + `data-video-views=200` present), status badge `Live channel data`, 9 filter chips, 12 thumbnails loaded, 0 page errors; dead `/api/videos` (503) → snapshot cards survive (11) with real published counts, 0 page errors; homepage untouched (2-up grid, full feed, 2 Shorts).
- Regression: `qa-pages.cjs` 22/0, `qa-scroll.cjs` 33/0, `qa-blog.cjs` 322/0; `node --check` clean on the function and `main.js`; `serve.cjs` now mirrors the production `/api/videos` rewrite locally.

Remaining delay (confirmed): after a redeploy the first visitor within ~5 min may get a ≤5-min-old cached response; after that, data is at most 15 minutes old (TTL). Without redeploying, the *snapshot-based* pages keep working, so the in-bundle snapshot can age until someone redeploys to refresh `videos.json` — the live-function path covers the gap end-to-end.
