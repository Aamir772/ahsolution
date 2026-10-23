# Mobile UI Audit — AH Solution (October 2026)

Scope: 11 documented mobile issues on the public site (https://ahsolution.live).
Constraints: smallest coherent set of changes, no redesign, desktop untouched,
no new dependencies, no hardcoded screenshot positions, no commit/push/deploy.

## Environment

- Static HTML + shared CSS/JS; pages served locally with `node scripts/serve.cjs`
  on `http://localhost:8000` (mirrors the production `/api/videos` rewrite so QA
  never 404s on the live-data fetch).
- Release mirror `release/v2.0/site/` kept in sync for changed root pages.

## Phase 1 — Baseline (recorded before any change)

Commands run (all green):

- `node scripts/build-ai-index.mjs` → 36 entries, OK.
- `node scripts/qa-pages.cjs` → **22 passed, 0 failed** (13 pages desktop +
  320/360/390/430 px narrow sweeps).
  - Note: on a stale local server the first run flagged `index.html` /
    `vlogs.html` with a single `404 /api/videos` console error. Cause: the
    running server instance predated the `/api/videos` stub in
    `scripts/serve.cjs:56`. Restarting the server against the current script
    cleared it. Environment issue, not a site bug.
- `node scripts/qa-blog.cjs` → **322 passed, 0 failed** (rebuilds images +
  manifest + published article pages from templates first).

Fresh mobile screenshots (Playwright, 390×844, deviceScaleFactor 2, local
server) saved to `C:\Users\haami\AppData\Local\Temp\ah-qa\out\mobile-audit-baseline\`:
`blog-top.png`, `blog-hover.png`, `blog-footer.png`, `index-hero.png`,
`index-hero-scrolled.png`, `vlogs-bottom.png`, `article-table.png`,
`article-faq.png`, `article-related*.png`, `article-footer.png`.

## Phase 2 — Findings & fixes (issue by issue)

### 1. Editor's Pick badge overlaps blog-card metadata
Evidence: the feature-card badge sits at `.card-image` `left:15px; top:14px`
(`assets/css/editorial.css:211`), exactly on top of the crimson
"AH SOLUTION · 07/17" label that is baked into every blog thumbnail's top-left
corner. Fix: move the badge to the top-right corner of the cover so it cannot
land on the drawn label either at the top-left or on the bottom-left category
tag. File: `assets/css/editorial.css`.

### 2. Blog-card hover effects clip edges
Root cause: `.content-card` uses a 3D tilt (`transform-style:preserve-3d`,
`data-tilt` rotation, translateZ offsets) plus large hover shadows/lifts. On
touch-shaped viewports these effects read visually as cards bleeding/clipping
past the frame and neighbours. Fix: under `(hover: none), (max-width:767.98px)`
flatten the 3D transforms (no tilt rotation, no translateZ body offset) and
scale the hover shadow down; desktop hover behaviour is untouched.
Files: `assets/css/styles.css`, `assets/css/editorial.css`.

### 3. "More from AH Solution" related cards clipped horizontally
Related cards reuse the same tilt card inside the article surface whose inset
padding leaves little headroom at 390px. Fix: same flatten-on-touch treatment
as issue 2 plus tighter mobile padding on `body.article-page .article-main`
so cards keep a safe distance from the surface border. Files: `assets/css/editorial.css`.

### 4. Footer excessively tall on mobile
Evidence (`blog-footer.png`): brand description, then EXPLORE / COMPANY /
CONNECT stacked single-column with mostly empty right half. Fix scoped to
≤700px: brand stays full-width, the three link columns run in two columns,
column/link margins and the wave decoration height reduce; ≤410px keeps the
two-column link layout instead of dropping back to one column.
File: `assets/css/styles.css`.

### 5. Blog tables overflow on mobile
Evidence (`article-table.png`): tables scroll inside `.table-wrap`, but header
cells are `white-space:nowrap`, so wide tables force hard cut-offs with an
invisible scrollbar. Fix (≤680px): allow header cells to wrap, reduce cell
padding/size, keep the existing horizontal scroll as the last resort.
File: `assets/css/editorial.css`.

### 6. Auto-numbering for FAQ questions
FAQ questions are plain `h3`s under `h2#frequently-asked-questions`. Fix: CSS
counter on the FAQ heading (reset per section = per FAQ h2), zero-padded
`01 / 02 / 03` labels in the crimson accent, applied via
`h2#frequently-asked-questions ~ h3`. Article pages are template-generated, so
the numbering is implemented in `assets/css/editorial.css` (no article HTML
edits needed) — the 17 published pages pick it up on the next
`node scripts/blog-build.js` / QA rebuild.

### 7. Homepage 3D model overlaps hero text
Mitigation on ≤700px: shrink the hero core (`min(320px, 100%)`) and give
`.hero-visual` breathing room; desktop layout untouched.
File: `assets/css/styles.css`.

### 8. Sticky mobile nav vs rounded frame
Evidence: the sticky header sits square-cornered inside the 42px-radius phone
frame; when scrolled its corners visibly collide with the bezel curve.
Fix (≤767.98px, in `assets/css/device.css`): round the sticky header's top
corners while scrolled so the bar retains visible containment in the frame.

### 9. Remove homepage hero social icons
The three 3D YouTube/Instagram/Facebook buttons are injected by
`assets/js/main.js` `socialIcons()` into `.hero-copy` (falling back to
`.footer-brand`). Fix: prefer `.footer-brand` as the injection host, so the
icons live in the footer brand block on every page (including the homepage)
and no longer appear under the hero copy. Footer socials are kept.

### 10. Replace "npm run fetch:videos" disclaimer
`setStatus()` rendered `… (npm run fetch:videos).` to all visitors. Fix in
`assets/js/main.js`: the info bar now reads
"Source: YouTube channel data · refreshed <date>" with an accessible
"About YouTube channel data" button. Timestamp is rendered only when the feed
carries a real `generatedAt` (cached snapshots show no date). The modal is a
`role="dialog"`/`aria-modal` overlay with labelled title and close control,
focus moved to its primary button on open and restored to the opener on close,
Escape/backdrop close, and body-scroll retained.

### 11. iPhone artwork in the Android Apps category card
`index.html:259` hotlinked an Unsplash iPhone photo as the Android Apps
category-card image. Replaced with a verified Samsung Galaxy photo
(`photo-1610945415295-d9bbf067e59c`, Samsung Galaxy S21 Ultra 5G on its box —
dark, on-brand Samsung Android device). Note: a literal Galaxy Z Fold product
shot could not be hotlink-verified against Unsplash (their photo pages block
scraping), so the verified Samsung device image was used; the URL can be
swapped later without other changes. Mirror updated:
`release/v2.0/site/index.html`.

## Phase 3 — Files changed

- `assets/css/styles.css` (footer mobile layout, hero core, touch-card flatten)
- `assets/css/editorial.css` (feature badge position, FAQ numbering, article
  mobile padding, table mobile rules, touch-card flatten)
- `assets/css/device.css` (scrolled sticky-header containment in phone frame)
- `assets/js/main.js` (social-icon host, video status info bar + accessible
  modal, friendly YouTube data copy)
- `index.html` (Android Apps card image)
- `release/v2.0/site/index.html` (mirror of the image change only — the
  mirror's own `assets/` copies predate the current css/js (v2.0 snapshot) and
  were already out of sync before this task; not touched).

## Phase 4 — Verification

QA results (final run, after all fixes):

- `node scripts/qa-pages.cjs` → **22 passed, 0 failed** (13 pages desktop sweep,
  320/360/390/430 px narrow sweeps, no horizontal overflow, no page errors).
- `node scripts/qa-blog.cjs` → **322 passed, 0 failed** (full rebuild + content
  checks on all 17 articles + 20-page desktop/mobile browser pass with no
  console errors / overflow / broken images; listing search/filter/sort/links
  all green).
- `node scripts/build-ai-index.mjs` → 36 entries (18 pages, 3 articles,
  15 videos), OK.

Visual re-verification (Playwright, 390×844 @2x, local server) — after-shots in
`C:\Users\haami\AppData\Local\Temp\ah-qa\out\mobile-audit-after\`:

- `after-blog-top.png` — Editor's Pick badge top-right, thumbnail label clear.
- `after-related-*.png` — related cards show the full 640/360 art incl. label
  (aspect-ratio fix); article body padding reduced.
- `after-blog-hover.png` — touch tap no longer clips/tilts the card.
- `after-footer-*.png` — footer compacted to two link columns, socials in
  footer brand, no hero socials on homepage.
- `after-article-table.png` — table fits 390 px with readable padding.
- `after-article-faq.png` — FAQ headings show 01/02 … auto-numbers.
- `after-hero-*.png` — hero core scaled down on mobile.
- `after-android-card.png` — Samsung device image in the Android Apps card.
- `after-status-*.png` / modal probes — info bar reads the new friendly copy;
  modal opens (focus on "Got it"), closes via button/Escape/backdrop with
  focus restored.
- `after-header-scrolled.png` — scrolled sticky header shows the rounded top
  corners inside the phone-frame containment.

 desktop QA in qa-blog (blog.html desktop pass, article pages) confirms desktop
layout unaffected by all the mobile-scoped media queries.

## Unresolved / notes

- None blocking at time of writing.
- The Android Apps card uses a verified Samsung Galaxy S21 Ultra 5G photo; can
  be swapped for a Galaxy Z Fold shot later by editing one URL in
  `index.html` (+ mirror).
- `release/v2.0/site/assets/` remains a stale v2.0 snapshot (pre-existing
  drift, confirmed before this task); only the mirrored `index.html` image
  change was applied there.

## Appendix — localization error toast (follow-up fix)

Reported separately: on selecting Tamil, a "Translation failed for part of
this page" toast rendered behind page content / overlapping the navigation.

Root causes found:

1. **Translation failure (real cause):** the **live production deploy has no
   `localize` function** — `https://ahsolution.live/api/localize` and
   `/.netlify/functions/localize` both return 404 (while `/api/videos` works,
   so it is a deployment gap, not a redirect problem). The client received an
   HTML 404 body, `res.json()` failed, and the error was reported as the
   generic `'network'` → generic toast copy. (The local Tamil dictionary is
   intentionally `complete:false` — pending generation — which is reported
   accurately already.)
2. **Toast layering:** `.lang-chip` was created inside the header `.lang`
   wrap, i.e. inside the scrolling/clipped `.device-screen`, with
   `position:fixed;bottom:18px` — on desktop it spilled over the monitor
   bezel/stand area of the device-frame decoration.

Fixes:

- `assets/js/localize.js`: the status chip is portaled to a shared
  `#ah-notify-root` div appended to `<body>`; `fetchBatch` now preserves the
  HTTP-level cause (`http_404` etc.) instead of collapsing everything into
  `network`; new `failureKind()`/`failureMessage()` classify errors into
  stale (service not deployed/configured — accurate message, no auto-retry),
  request, and retryable (network/limits/upstream — Retry button that retries
  only the failed translation, preserving translated sections); a
  `retryLock` latch stops the MutationObserver from hammering a dead
  endpoint until the user explicitly retries or switches language.
- `assets/css/styles.css`: `.lang-chip` is now explicit about stacking and
  placement — viewport-fixed bottom-center with `env(safe-area-inset-bottom)`,
  inside the rendered monitor screen on desktop
  (`--dw-world-b + --dw-bezel` offset), z-index 420 (above header 90 and
  device chrome 60), max-width respecting screen bounds.
- Verified: desktop 1366px and mobile 390px screenshots
  (`localize-toast-desktop.png`, `localize-toast-mobile.png` in
  `...\ah-qa\out\`), transient-failure Retry path, dead-service message,
  English restore. `qa-pages` 22/0, `qa-blog` 322/0, AI index OK.
- Note: the actual production fix still requires **deploying the `localize`
  Netlify function** (and `GEMINI_API_KEY` + Upstash or
  `LOCALIZE_REQUIRE_DURABLE_LIMIT=0`) — the client now reports that state
  accurately instead of a generic failure.
