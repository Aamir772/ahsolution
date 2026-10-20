# AH Solution — SEO Remediation Report

**Date:** 2026-10-20
**Baseline:** `reports/seo-audit-report.md` + `reports/seo-audit-issues.csv` (33 issues)
**Constraint honored:** no deploy, no commit/push, no DNS/webmaster submissions, no draft publishing. All 17 articles remain `publish_status: "draft"` / `status: "draft_for_review"`.
**Files inspected before modifying:** `scripts/blog-build.js`, `scripts/qa-blog.cjs`, `article.html`, `blog/schema/blogposting-videoobject-template.html`, `netlify.toml`, `about.html`, `sitemap.xml`, `assets/css/editorial.css`, all 17 `article/<slug>/index.html`, `blog/blog-manifest.json`, `blog/assets/*-cover.png`.

---

## Phase 1 — Publication safety (draft-for-review enforced)

### Investigation: why the audit saw 17 indexable drafts
- Production pages are **statically generated** at `/article/<slug>/index.html` by `scripts/blog-build.js`, which ignores `publish_status` and hard-writes `<link rel="canonical">` (line 272), `og:url`, full indexable metadata, and injects **all 17 URLs into `sitemap.xml` regardless of status** (old line 450).
- `scripts/blog-manifest-sync.js` actively preserves the draft state on every sync (`row.publish_status = 'draft'; row.canonical_url = 'SET_ONLY_AFTER_PUBLISHING'`) — so the manifest was honest; the **build script** was the exposure mechanism. Channel: build output committed to repo → deployed with the site.
- Conclusion: changing a manifest field alone would have done nothing. The generator and sitemap injection were patched instead.

### Corrections made
1. **`scripts/blog-build.js` — status-driven publication gate** (articlePage + main):
   - A record is treated as **approved** only when `publish_status === 'published'` **and** `canonical_url` is a real URL (not `SET_ONLY_AFTER_PUBLISHING`).
   - Draft pages now emit: `<meta name="robots" content="noindex, nofollow">`, **no canonical**, **no og:url**, and a visible `.draft-ribbon` ("Draft for review — not yet published").
   - When the operator later approves (flips `publish_status` + sets `canonical_url`), the next build automatically produces an indexable page with canonical/og:url + `lastmod`-stamped sitemap entry. No further code change needed.
2. **Sitemap gating:** only approved articles are injected. All 17 are drafts → **article region is now empty**; sitemap has 11 static URLs (`robots.txt` reference unchanged and correct). `<lastmod>` is added per approved entry derived from the markdown source file's real mtime — reliable-date source; omitted if unavailable.
3. **qa-blog.cjs rewritten to the draft contract** (no assertion weakened): artifacts checks now require per-status protection — drafts MUST have noindex/no-canonical/ribbon; approved MUST have canonical/og:url/no-noindex. Sitemap check now asserts "every approved article listed AND every draft absent".
4. **Local review experience preserved:** all 17 pages still render fully (HTTP 200, one H1, JSON-LD intact), blog.html listing cards still link to them and open correctly (browser test: "listing: clicking a card opens its article page" ✓), and editors can keep reviewing draft URLs directly.
5. **Manifest untouched:** `publish_status`/`canonical_url` stay as the workflow requires for all 17 rows (QA re-asserts this).

### Deploy-requires-release verdict
**Yes — the deployed site requires a corrective release.** The live domain still serves the pre-fix static files: 17 indexable draft articles, a sitemap containing 17 article URLs, and an indexable `article.html` shell. Until authorized deploy: search engines can still index the live drafts. Everything in the repo is now correct for the next deploy; this audit made no attempt to publish, unpublish or deploy anything.

---

## Phase 2 — Broken social-preview images (og:image 404 live)

Evidence chain:
- All **17 `/blog/assets/<slug>-cover.png` files exist on disk locally (17/17 verified)** — source generation (`scripts/blog-raster.js`) and the build preference logic (`blog-build.js: coverPng + fs.existsSync`) are correct.
- `articlePage()` emits `og:image = https://ahsolution.live/blog/assets/<slug>-cover.png` — the path is right; qa-blog asserts a real raster PNG per page (`og:image is not a raster PNG` check passes).
- Live `HEAD https://ahsolution.live/blog/assets/iqoo-z5-5g-unboxing-first-look-cover.png` → **404** while `sitemap.xml` → 200: the deployed tree simply **predates this blog build** (older deploy without the regenerated assets).
- Root cause: **deploy lag, not a code defect.** Correct fix = one authorized deploy; no fabricated URLs or placeholder images were introduced, and none were needed locally. Local verification confirms each expected asset at each expected URL path (17/17).
- Postdeploy follow-up (for the release checklist): re-verify all 17 og:image URLs return 200 on the live domain.

---

## Phase 3 — Remaining SEO gaps

1. **`article.html` runtime shell (S-02):** `<meta name="robots" content="noindex, nofollow">` added to the shell's head; plus `X-Robots-Tag: noindex, nofollow` headers in `netlify.toml` for the **exact routes** `/article` and `/article.html` only (deliberately NOT `/article/*` — subpaths are real article files whose indexable state must remain status-controlled). Shell keeps its canonical pointing at itself (harmless once noindexed; documents its own URL).
2. **Schema template (S-03):** `blog/schema/blogposting-videoobject-template.html` wrapped in a minimal `<!doctype>` head with `noindex, nofollow` (it is internal documentation, not a public page). Served bytes 1477, HTTP 200, robots confirmed.
3. **Sitemap lastmod (E-01):** implemented for approved articles only (md-source mtime). All current articles are drafts and correctly absent; existing 11 static entries already carry lastmod.
4. **Long-title review (T-01…T-17): reviewed individually; all 16 long article titles retained.** Rationale per review:
   - Every article title is unique (30/30 site-wide), contains the exact product/topic plus search intent ("unboxing/review/buying/how-to/risks"), and uses Hinglish matching the visible content and article language.
   - SERP-wise the only element at truncation risk is the ` | AH Solution` suffix (14 chars) — the differentiating part always renders.
   - `og:site_name` + JSON-LD publisher already carry the brand; forcing 60-char rewrites, e.g. for `Android Phone Se DSLR-Like Night Photos Kaise Lein: Long Exposure Guide`, would sacrifice the primary keyword precision for arbitrary length. **No blind rewrite; titles preserved.** (T-19 shell title is moot — now noindexed.)
5. **About editorial-standards section (AB-01):** added a "How content is checked" paragraph to `about.html` describing exactly the real process: guide built from the original video, cross-checked on-screen, reviewed by the AH Solution Editorial Team, unverifiable items held out, draft banner until approved. No fabricated credentials; all statements match actual pipeline behavior (blog-build QA + manifest fields).
6. **Structured-data validation (F-01):** all JSON-LD re-validated in the browser across 30 pages — **0 parse failures**. `BlogPosting` (headline = manifest/visible title, real author/publisher `Organization`, no invented `datePublished`), `VideoObject` (real embed id, `uploadDate` = true video publish date) unchanged and correct. **No FAQPage markup added** — per instruction not to pursue rich results; FAQ content remains plain HTML above the fold (decision documented in the audit FAQ section).

---

## Test results (re-run after all changes)

| Suite | Result | Notes |
|---|---|---|
| `node scripts/qa-blog.cjs` | **322 passed, 0 failed** | detects 17 draft-protected pages, 0 article sitemap URLs, pipeline rebuilts cleanly |
| `node scripts/qa-pages.cjs` | **22/22** | desktop + mobile |
| `node scripts/qa-device.cjs` | **27/27** | loader/session intro |
| Browser probe (playwright, all 30 routes) | **17/17 articles:** `noindex, nofollow` present, no canonical, no og:url, exactly 1 H1, valid JSON-LD, draft ribbon visible; **shell:** noindex applied; **0 JSON-LD invalid** | `seo-data.json` artifacts off-repo |
| HTTP spot checks (local server) | article draft 200 + noindex · `/article.html` 200 + noindex · schema template 200 + noindex · `blog.html` 200 indexable (correct) · sitemap served identical to disk | all 200 |
| Sitemap | 11 `<url>` (11 static incl. 3 guides), **0 article URLs**, `lastmod` on every entry, valid XML served byte-identical | draft region empty |
| earlier-session suites still valid | ai-qa 74/74, qa-admin 80/80, assistant 165/165 | no site-behavior dependency touched by remediation |

Corrected bookkeeping note: the audit's "13 static + 17 articles" was a count error in the audit report; the true pre-fix totals were 11 static + 17 articles = 28 URLs. This report uses the corrected figures.

---

## Remaining limitations (unchanged or intentionally not done)

1. **Authorized deploy required** — live production still serves the exposed drafts (Phase 1) and 17 og:image 404s (Phase 2). Both are release-gated, not code-gated; re-verify after deploy.
2. GSC/Bing verification + sitemap submission not done (external, account access; sitemap should be submitted only after the corrective deploy).
3. Draft pages remain reachable by direct URL by design (review workflow). noindex prevents indexing; it does not prevent manual URL access. If "unreachable by URL" gating is ever required, that needs server-side auth — outside draft-for-review scope and deliberately not implemented.
4. Article titles intentionally unchanged (per-item rationale above; revocable anytime with a manifest `meta_title` edit + rebuild).
5. WebP conversion still pending in the by-design pipeline state (`image_status: svg_generated_webp_pending`), untouched per audit constraint.

## Fix ledger (audit issue IDs)

| ID | Resolution |
|---|---|
| S-01 publication mismatch | FIXED in code (status-driven build + sitemap gate + QA); live fix pending deploy |
| E-01 sitemap lastmod | FIXED for approved entries (mtime-based); drafts correctly absent |
| E-02 article shell indexing | FIXED (page meta + netlify.toml exact-route headers) |
| E-03 schema template reachable | FIXED (noindex head) |
| T-01…T-17 long titles | REVIEWED — retained (rationale documented); T-19 shell title moot (noindex) |
| AB-01 About editorial standards | FIXED (new "How content is checked" paragraph) |
| F-01 FAQPage absence | DOCUMENTED decision — not added (instruction honored) |
| O-01 og:image 404 live | ROOT CAUSE CONFIRMED (deploy lag; assets 17/17 correct locally) — deploy required |
| G-01/B-01 webmaster verification | NOT POSSIBLE in this task (external accounts) — exact steps remain in audit report |
| AU-01 author profile link | Deferred (optional E-E-A-T enhancement; attribution itself verified consistent) |
