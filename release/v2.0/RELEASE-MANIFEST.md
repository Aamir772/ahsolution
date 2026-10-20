# AH Solution — Release Manifest V2.0

- **Release version:** 2.0.0 (release designation; the project's own `package.json` version is `3.1.0` and was deliberately not modified — the repo's existing semantic versioning convention continues independently)
- **Build date:** 2026-10-20 14:00 IST (UTC+05:30); generated files stamped `2026-10-20T07:55Z`
- **Source repo:** `F:\AI Project\AH Solution`, branch `master`, commit `83036f8` ("chore: commit AH Solution website and admin CMS") plus uncommitted working-tree changes (all QA-verified; nothing committed by this build)
- **Deployment target:** existing Netlify site `ahsolution.live`, manual **Netlify Drop** of `AH-Solution-v2.0-Netlify.zip`

## Build commands actually executed (in order)

1. `npm run blog:sync` — manifest validation / sync (17 records, 27,137 words)
2. `npm run blog:images` — wrote 51 SVG illustrations to `blog/assets/`
3. `npm run blog:build` (runs `blog-raster.js` && `blog-build.js`) — wrote 17 PNG covers (1200×630), 17 article pages, blog cards, sitemap
4. `node scripts/qa-blog.cjs` → 322 passed / 0 failed (includes its own full rebuild pass)
5. `node scripts/qa-pages.cjs` → 22/0
6. `node scripts/qa-device.cjs` → 27/0
7. `node scripts/qa-scroll.cjs` → 33/0
8. `node scripts/qa-admin.cjs` → 80/0
9. `node scripts/ai-qa.cjs` → 74/0
10. `npm run assistant:test` (`node --test "server/test/*.test.js"`) → 165/0
11. Release assembly + static verification of the output directory → 34/0
12. Runtime browser QA against the release directory (Playwright, served on :8010) → 26/0
13. ZIP packaging + extraction/hash verification → 9/0

## Output structure

| Path | Contents |
|---|---|
| `release/v2.0/site/` | 142 files: 34 HTML pages (10 root pages, 17 article routes, 3 guides, 4 admin pages), 86 images (17 article covers + 51 SVG illustrations + favicons/OG/deco), 22 other (CSS, JS, JSON data, `netlify`, manifest, favicon, `robots`, `sitemap`) |
| `release/v2.0/AH-Solution-v2.0-Netlify.zip` | 3,579,552 bytes (3.42 MB), SHA-256 `d3d70a72b100dd7ed7b4c5b79317280e0bbbc7503127f3d57db04ca1d9e7ac74`; website files at archive root (no enclosing folder) |

The release directory is self-contained: every local asset reference in every HTML/CSS/JS file was resolved against the output tree in a crawl (34/0 static check).

## Counts

- Sitemap: **28 URLs** (11 static + 17 articles), 0 duplicates, every entry with an accurate `lastmod` derived from file mtimes
- Articles: **17 published** (unique slugs, canonical `https://ahsolution.live/article/<slug>/`, BlogPosting + VideoObject JSON-LD, og:image present on disk)
- Blog listing: **20 cards** (17 articles + 3 hand-written guides), search / category chips / sort / result counter / empty state functional
- Covers: **17 PNG** at the exact `og:image` paths

## Hosting configuration shipped (Netlify Drop)

Netlify Drop **does** honour these files in the upload root:

- `_headers` — mirrors all `netlify.toml` header rules: global security headers, 7-day cache for `/assets/*`, `/assets/css/*`, `/assets/js/*`; `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-store` for `/admin/*`; draft-protection `noindex` on the runtime shell routes `/article` and `/article.html` only (never `/article/*`)
- `_redirects` — `/article` → `/article.html`, `/article/*` → `/article.html?slug=:splat` (200 rewrites; real static article files take precedence), `/admin`, `/admin/dashboard`, `/admin/editor` entries
- `404.html` — served automatically as the legacy 404 page
- `netlify.toml` — included for completeness; **not read by Drop uploads** (only `_headers`/`_redirects` above are)

### Drop limitations (must know)

- A Netlify Drop is a **static, functions-less deploy**. The admin panel's `/.netlify/functions/*` endpoints (`admin-auth`, `articles`, `init-admin`, `solution-ai-chat`, `upload-cover`) and therefore admin login/editor actions and the AI-chat backend **cannot run on a Drop upload**. The admin UI pages and anonym-safe behaviour ship in the build; restoring full dynamic features requires the normal git/CLI deploy with functions + environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AH_*`). No secrets are in the release (verified).
- The site search modal (`/`-key) probes `/.netlify/functions/ai-index`; on a static upload it survives as graceful degradation (expected 404, no page errors — QA-verified).

## QA results

| Suite | Result |
|---|---|
| Source QA (blog/pages/device/scroll/admin/ai) | 322 + 22 + 27 + 33 + 80 + 74 = **558/0** |
| Server (assistant) tests | **165/0** |
| Release static verify (inventory, sitemap, 17 pages, 17 covers, asset-graph resolution, secrets scan, leak scan) | **34/0** |
| Release runtime browser QA (boot/3D, 28 routes sweep desktop+mobile, blog search/filter, article indexing, admin pages) | **26/0** |
| ZIP open/extract/compare | **9/0**, byte-identical to `site/` |

## Included deliberately, excluded deliberately

- **Included:** `admin/` UI (pages + CSS/JS), `assets/` (incl. `three.module.min.js`, `globe.js` 3D engine assets), `blog/blog-manifest.json` + `blog/assets/` (68 files), all 10 root pages, 17 article routes, 3 guides, favicon/webmanifest.
- **Excluded:** `.git`, `node_modules` (none present), `.env*`, all API-key/credential material, `netlify/functions` sources (server-side only, never published in a static upload), `server/`, `agent/`, `scripts/`, `supabase/` (secrets-adjacent backend), `reference/`, `reports/`, dev docs (`README.md`, `blog/*.md`, blog source markdown), package manifest, logs/temp files.

## Known limitations & post-deployment verification steps

1. Article URLs should 200 with the article headline + canonical `https://ahsolution.live/article/<slug>/`, no `noindex`, no draft ribbon — spot-check 2–3 of 17.
2. `https://ahsolution.live/sitemap.xml` should list 28 URLs; covers `https://ahsolution.live/blog/assets/<slug>-cover.png` load 200 (17 URLs).
3. `blog.html` search/chips work offline (no backend needed). Search-modal AI results on `/` return empty on Drop until full functions deploy is restored.
4. Admin pages show `X-Robots-Tag: noindex` — verify headers via `curl -I https://ahsolution.live/admin/login.html`.
5. `/_headers` and `/_redirects` are **consumed by Netlify** at deploy time and are not publicly served; do not expect them at those URLs (404 is normal).
