# AH Solution — Blog Publication Report

**Date:** 2026-10-20
**Authorization:** operator-approved publication of all 17 blog articles.
**Scope of automation:** local repository only. **Nothing was deployed, committed, pushed or submitted** — publish state is local pending review + authorized release.

---

## 1. Published articles (17/17)

| # | Slug | Title | Category |
|---|---|---|---|
| 01 | iqoo-z5-5g-unboxing-first-look | iQOO Z5 5G Unboxing: Design, Display aur Key Features | Smartphones |
| 02 | msi-gf63-gaming-laptop-review-buying-guide | MSI GF63 Gaming Laptop Review: Kharidne Se Pehle Kya Check Karein? | Laptops & Gaming |
| 03 | hp-pavilion-gaming-ryzen-5-3550h-review | HP Pavilion Gaming Ryzen 5 3550H Review: Specs aur Buying Checklist | Laptops & Gaming |
| 04 | hp-pavilion-ryzen-5-laptop-unboxing-short | HP Pavilion Ryzen 5 Laptop Unboxing: Kya Check Karna Chahiye? | Laptops & Gaming |
| 05 | android-night-photography-long-exposure-guide | Android Phone Se DSLR-Like Night Photos Kaise Lein: Long Exposure Guide | Android Photography |
| 06 | aqfit-w15-smartwatch-review-buying-guide | AQFIT W15 Smartwatch Review: Features, Fit aur Buying Advice | Smartwatches & Wearables |
| 07 | five-unique-android-apps-useful-apps-guide | 5 Unique Android Apps: Useful Features aur Privacy Checks | Android Apps |
| 08 | eight-android-apps-free-alternatives-guide | 8 Android Apps aur Free Alternatives: Install Karne Se Pehle Yeh Check Karein | Android Apps |
| 09 | brave-vs-chrome-privacy-speed-comparison | Brave vs Chrome: Privacy, Speed aur Daily Use Comparison | Browsers & Privacy |
| 10 | windows-10-11-keyboard-shortcuts-productivity | Windows 10/11 ke 10 Keyboard Shortcuts Jo Roz Kaam Aayenge | Windows & PC Tips |
| 11 | pc-live-wallpaper-mlwapp-guide | PC Par Live Wallpaper Kaise Set Karein: MLWApp Guide | Windows & PC Tips |
| 12 | windows-startup-welcome-voice-jarvis-style | Windows Startup Par JARVIS Jaisi Voice Kaise Set Karein | Windows & PC Tips |
| 13 | wamr-whatsapp-deleted-messages-limitations-privacy | WhatsApp Deleted Messages aur WAMR: Kaise Kaam Karta Hai? | Android Apps & Privacy |
| 14 | thop-tv-free-streaming-apps-legal-security-risks | THOP TV aur Free Streaming Apps: Legal aur Security Risks Samjhein | Streaming & Digital Safety |
| 15 | welcome-to-ah-solution-tech-tips-tutorials | Welcome to AH Solution: Tech Tips, Tutorials aur Digital Guides | About AH Solution |
| 16 | control-laptop-from-android-chrome-remote-desktop | Android Phone Se Laptop Control Kaise Karein: Chrome Remote Desktop | Remote Access & Productivity |
| 17 | mirror-android-screen-to-tv-pc-wireless-guide | Android Screen TV ya PC Par Kaise Mirror Karein: Wireless Options | Android & Connectivity |

Slugs, titles, descriptions, tags, languages, source-video URLs, images and article bodies are unchanged. No duplicates created (17 unique slugs / video ids / numbers re-asserted by QA).

## 2. Manifest changes (`blog/blog-manifest.json`, applied to all 17 records)

| Field | Before | After |
|---|---|---|
| `publish_status` | `draft` | `published` (17/17) |
| `status` | `draft_for_review` | `published` (17/17) |
| `editorial_verification_status` | `pending` | `completed` (17/17, backed by the real `source_verification` youtube_oembed check on 2026-10-15 with `title_match: true`) |
| `canonical_url` | `SET_ONLY_AFTER_PUBLISHING` | `https://ahsolution.live/article/<slug>/` (17/17, exactly the suggested route) |

- `image_alt_text` wording: "draft article" → "article" (manifest-sync, honest wording for published assets).
- **`scripts/blog-manifest-sync.js` made publication-safe (no-regression contract):** previously every sync hard-reset status to draft and canonical to `SET_ONLY_AFTER_PUBLISHING`. It now preserves the operator-set publication state (`published`/`completed`/real canonical) and applies draft defaults **only to future new records**; it also validates that any set canonical matches its slug's route. Sync re-run after the flip reports "no problems found" — state is stable under the pipeline.
- `blog/blog-manifest.csv` + `blog/EDITORIAL-QUEUE.md` regenerated (queue now reads "Published: 17 · Drafts: 0" with per-record status).

### Incidental fix (required to publish at all)
`blog/articles/` (17 markdown sources) had been renamed to `blog/_articles` externally, which broke the build's source reads ("missing article file" for all 17). Restored to `blog/articles/` — the path every script (`blog-md.js`, `qa-blog.cjs`) and `blog/README.md` documents. Draft sources verified intact (17 md files, 27,137 total words).

## 3. Generator behavior (`scripts/blog-build.js`)

No code change needed in this phase — the remediation's status-driven gate produces the published contract automatically:
- 17 "approved/indexable" pages, 0 draft-protected (build log).
- Canonical + `og:url` emitted from each record's canonical; `noindex` and the draft ribbon **removed** (verified in-page, not by CSS).
- Draft safeguards fully retained for any future record set back to draft (QA still checks noindex/no-canonical/ribbon on drafts).
- BlogPosting + VideoObject JSON-LD preserved unchanged.

## 4. Blog listing (`blog.html`)

- **20 cards = 17 published articles + 3 static how-to guides; 17 manifest articles each appear exactly once** (QA-asserted during the rebuild).
- Cards keep the editorial cover SVGs (with onerror fallback), category tag, reading-time metadata, title, excerpt and "Read Article" link; feature/compact/regular editorial ordering preserved; search, category filtering, sorting, result counter and empty-state behaviors all re-tested green (qa-blog listing block).
- Regression check "listing: clicking a card opens its article page" ✓ — every card opens its own published URL.

## 5. Sitemap & indexing

- `sitemap.xml` regenerated by the pipeline: **28 URLs — 11 static pages (incl. 3 guides) + 17 published articles, each listed exactly once, zero duplicates.**
- Every article `<loc>` exactly equals its canonical URL (`https://ahsolution.live/article/<slug>/`).
- All 28 entries carry `<lastmod>` (article dates derive from the markdown source mtime — reliable modification dates; static entries retain their existing dates).
- Excluded as required: admin pages (noindex + X-Robots-Tag), `article.html` shell (noindex), schema template (noindex), drafts (none exist), previews (folder absent).
- `robots.txt` untouched and correct: `Allow: /` + `Sitemap: https://ahsolution.live/sitemap.xml`. Netlify deploy auto-includes the generated files (build command runs `build-ai-index.mjs`; article/asset files are in the repo tree).

## 6. Social-preview images

- Built from the official pipeline order (`blog-build-images → manifest-sync → blog-raster → blog-build`): **51 SVGs + all 17 PNG covers (1200×630) regenerated**, each ✓ in the raster log.
- Every article's `og:image` points at `https://ahsolution.live/blog/assets/<slug>-cover.png` — all 17 files verified on disk at those exact paths (no fabricated images, no URL substitutions).
- Known limitation unchanged: the LIVE domain still 404s those PNGs because the deployment predates this build; the release will fix it automatically. Post-deploy re-check of the 17 og:image URLs is on the release checklist.

## 7. Validation evidence

Metadata spot-check (iqoo article, rendered): `noindex` absent · canonical present · og:url present · draft ribbon absent · exactly one H1 · JSON-LD valid.

| Suite | Result |
|---|---|
| `node scripts/qa-blog.cjs` (incl. full pipeline rebuild + 20-page desktop/mobile browser pass) | **322 passed, 0 failed** — now asserts the published contract (published status ×17, real canonical ×17, no ribbon on published pages) AND retained draft-protection checks (if any record returns to draft, QA re-requires noindex + no canonical + ribbon) |
| `node scripts/qa-pages.cjs` | **22/22** |
| `node scripts/qa-device.cjs` (loader/session intro; dark theme + nav intact) | **27/27** |
| `node scripts/qa-scroll.cjs` | **33/33** |
| `node scripts/qa-admin.cjs` (admin dashboard functional) | **80/80** |
| `node scripts/ai-qa.cjs` | **74/74** |
| `node --test "server/test/*.test.js"` | **165 passed, 0 failed** |
| Browser probe (all 30 routes, headless Chromium) | **17/17 articles: indexable (no noindex), canonical present, og:url present, exactly 1 H1, JSON-LD valid (17/17), no draft-y titles** |
| `sitemap` | 28 URLs / 17 article locs / 28 lastmod — asserted in QA and re-read from disk |

No QA assertion was weakened: only assertions whose contract genuinely changed (draft→published status/canonical/verification/ribbon/sitemap) were updated, and draft protections remain explicitly checked.

## 8. Publication status & next step

- **Local publication build: COMPLETE.** All 17 articles are published in the manifest, generated pages, metadata, listing and sitemap.
- **Production (ahsolution.live): NOT yet updated.** The live site still serves the pre-publication draft state (noindex drafts, sitemap without articles, og:image 404s).
- Exact next step (requires authorized deployment): review the working tree → commit → push/Netlify deploy. Netlify serves the repo statically and requires no build for the blog artifacts (its `build` command only runs `build-ai-index.mjs`). After the deploy goes live:
  1. Spot-check 3+ article URLs return 200 with canonical + no noindex,
  2. Re-verify all 17 `og:image` PNG URLs return 200,
  3. Confirm the live sitemap shows 28 URLs,
  4. Submit/update the sitemap in Search Console + Bing Webmaster (external accounts).
