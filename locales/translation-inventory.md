# Translation inventory and coverage report

Last verified: 2026-10-23
Canonical source: `locales/en.json`
Status manifest: `locales/manifest.json`

This document records what is localized, how the runtime applies it, what is
still English-only, and the evidence used to verify the current build. It is a
snapshot, not a promise: entries marked **pending** must not be described as
finished translations.

## 1. Locale model

| Code | Language | Direction | Dictionary keys | Translated | Status |
| --- | --- | --- | ---: | ---: | --- |
| `en` | English | ltr | 277 | 277 | canonical / default / fallback |
| `hi` | Hindi | ltr | 277 | 0 | pending |
| `es` | Spanish | ltr | 277 | 0 | pending |
| `fr` | French | ltr | 277 | 0 | pending |
| `de` | German | ltr | 277 | 0 | pending |
| `pt` | Portuguese | ltr | 277 | 0 | pending |
| `ar` | Arabic | rtl | 277 | 0 | pending |
| `bn` | Bengali | ltr | 277 | 0 | pending |
| `ja` | Japanese | ltr | 277 | 0 | pending |

English is the only complete dictionary. Every target mirror has the same key
tree with `null` values, `meta.complete: false`, and `meta.status: "pending"`.
No machine translation has been stored in this repository yet.

## 2. Canonical key inventory

`locales/en.json` contains 283 leaf values: 6 `meta.*` fields plus 277
translatable UI strings.

| Section | Keys | Covers |
| --- | ---: | --- |
| `meta` | 6 | locale metadata (not translated) |
| `common` | 17 | shared verbs, states, retry/dismiss/copy |
| `brand` | 7 | brand name, taglines, channel labels |
| `navigation` | 12 | header, mobile menu, skip link |
| `search` | 14 | search dialog, placeholders, empty/loading states |
| `language` | 23 | selector, panel, status chip, failure messages |
| `youtube` | 23 | play/open/watch/loading labels and modal copy |
| `hero` | 9 | homepage hero |
| `categories` | 15 | category carousel labels and aria text |
| `home` | 23 | homepage section headings, newsletter, ad slot |
| `videos` | 32 | video library filters, sort, notes, CTAs |
| `blog` | 20 | blog hero, filters, sort, empty state, footer note |
| `tutorials` | 10 | tutorial page headings and filters |
| `about` | 9 | about page headings |
| `contact` | 17 | contact form labels, statuses, direct-contact copy |
| `privacy` | 5 | privacy page headings |
| `terms` | 5 | terms page headings |
| `notFound` | 5 | 404 page |
| `footer` | 13 | footer groups, social links, legal line |
| `ai` | 18 | SOLUTION AI panel chrome |

Placeholders use `{{name}}` and are validated for parity in every locale:
`{{shown}}`, `{{total}}`, `{{query}}`, `{{count}}`, `{{lang}}`, `{{date}}`,
`{{label}}`.

## 3. Runtime behaviour

`assets/js/localize.js` is the single client runtime.

- At boot it sets `lang`/`dir` from `LOCALES`, loads `locales/en.json` as the
  fallback, restores `ah_lang` if valid, and never auto-detects by IP/geo.
- UI strings come from local JSON only. `applyDictionary()` walks the document,
  reverse-matches exact canonical English values, and rewrites text nodes,
  `aria-label`, image `alt`, and input/textarea placeholders. Matches are
  marked so they are never sent to the content API again. This applies to
  chrome and to static in-page UI (cards, filters, CTAs), not only the header.
- Article/video/body copy that is not in the dictionary is translated on
  demand through `/api/localize`, with per-locale caching in `localStorage`.
  Content translation is sequential and stops at the first failed batch.
- Pending dictionaries fall back to English for unseen strings, keep the page
  usable, and show a "Interface strings pending for …" status chip. They are
  labelled `pending` in the selector.
- A failed dictionary request keeps the English content and chrome; the
  selector still works.
- Switching locale preserves the current route, search input, and scroll
  state; `ah_lang` persists across reloads.
- Returning to English restores the original text nodes and attributes; no API
  call is made for the English restore.

## 4. File and route coverage

Public HTML pages that include `assets/js/localize.js` (30 files):

- Core: `index.html`, `vlogs.html`, `blog.html`, `tutorials.html`,
  `about.html`, `contact.html`, `privacy.html`, `terms.html`, `404.html`,
  `article.html`
- Guides: `guides/live-wallpaper-on-pc.html`,
  `guides/choose-android-apps-safely.html`,
  `guides/budget-smartwatch-checklist.html`
- Generated articles (17 manifest routes under `article/<slug>/index.html`):
  iqoo-z5-5g-unboxing-first-look; msi-gf63-gaming-laptop-review-buying-guide;
  hp-pavilion-gaming-ryzen-5-3550h-review; hp-pavilion-ryzen-5-laptop-unboxing-short;
  android-night-photography-long-exposure-guide; aqfit-w15-smartwatch-review-buying-guide;
  five-unique-android-apps-useful-apps-guide; eight-android-apps-free-alternatives-guide;
  brave-vs-chrome-privacy-speed-comparison; windows-10-11-keyboard-shortcuts-productivity;
  pc-live-wallpaper-mlwapp-guide; windows-startup-welcome-voice-jarvis-style;
  wamr-whatsapp-deleted-messages-limitations-privacy; thop-tv-free-streaming-apps-legal-security-risks;
  welcome-to-ah-solution-tech-tips-tutorials; control-laptop-from-android-chrome-remote-desktop;
  mirror-android-screen-to-tv-pc-wireless-guide

Intentionally excluded:

- `admin/login.html`, `admin/dashboard.html`, `admin/editor.html`,
  `admin/reset-password.html` — internal tools, English only.
- `blog/schema/blogposting-videoobject-template.html` — schema template, not a
  public page.
- `release/v2.0/site/**` — frozen v2.0 archive, not the live site.

## 5. Known gaps (still English-only)

These are user-visible strings or documents that are not yet routed through the
dictionary. They are documented rather than silently claimed as localized.

### JavaScript-generated UI

| File | Location | String(s) |
| --- | --- | --- |
| `assets/js/main.js` | 253 | `YouTube video` fallback title |
| `assets/js/main.js` | 335, 357 | `Play: <title>` aria labels |
| `assets/js/main.js` | 544 | `Loading more videos` aria label |
| `assets/js/main.js` | 701 | `Showing <n> of <m> articles` counter |
| `assets/js/main.js` | 801 | `No matches. Try "android", "pc", …` |
| `assets/js/main.js` | 867, 871 | newsletter validation/opening status |
| `assets/js/main.js` | 884 | `Link copied ✓` |
| `assets/js/main.js` | 138 | social nav aria label |
| `assets/js/cms.js` | 187 | `<category> · <n> MIN READ` kicker |
| `assets/js/cms.js` | 232, 236, 248, 253 | `Pick an article…`, `Loading article…`, load failure, `Article not found` |
| `assets/js/device.js` | 55 | rotating decorative quotes |
| `assets/js/device.js` | 119 | `Device view` / `Full width` toggle label |
| `assets/js/globe.js` | 159 | `Interactive three-dimensional …` aria label |

### SOLUTION AI panel

`assets/js/ai.js` has its own `I18N` table (English + Hindi) at line 66 and its
own English/Hindi `langSel`. It is not connected to the site locale selector,
so the AI panel does not follow `hi/es/fr/de/pt/ar/bn/ja` selected from the
header. Agent status strings such as `PC agent online/offline` (lines 614–626)
are also hardcoded. The `ai.*` dictionary keys exist for future wiring.

### Content and metadata

- Article/guide/CMS body copy is translated only when `/api/localize` is
  available; otherwise it stays English even in a target locale.
- Document titles for CMS-loaded articles (`cms.js:120`) are not translated;
  static page titles are translated only when they exactly match `meta.*`.
- Meta descriptions, Open Graph/Twitter tags, JSON-LD, `sitemap.xml`, and URL
  slugs remain English. Search/AI retrieval uses the English
  `assets/data/ai-index.json` corpus (36 entries).
- YouTube's embedded player, captions, and third-party chrome are outside the
  site's control.
- Native browser validation messages and the admin area are not localized.

## 6. SEO decision

The site keeps one URL per page and switches language client-side, updating
`<html lang>` and `<html dir>` only. There are no locale-prefixed routes and no
`hreflang` alternates, so search engines index the English canonical pages.
This is a deliberate limitation of the current static-host architecture; adding
crawlable localized routes would require prerendering or per-locale URLs.

## 7. Validation and QA evidence

```text
node scripts/i18n-validate.cjs
  canonical: locales/en.json (277 keys)
  8 targets, each pending 0/277 (0%), 277 null
  OK: dictionaries valid; pending locales fall back to English.

node scripts/qa-pages.cjs        -> pages: 22 passed, 0 failed
node scripts/qa-blog.cjs         -> BLOG QA: 322 passed, 0 failed
node scripts/build-ai-index.mjs  -> 36 entries (18 pages, 3 articles, 15 videos)
```

Localization browser QA (`qa-i18n`, Chromium, local `:8000`): **37 passed,
0 failed**. It covers default `en`/ltr, 9 locales, public `t()` and
interpolation, pending labels and native names, persisted `ah_lang`, English
fallback chrome, non-blank content, Arabic RTL, restore-to-English, reloads,
deep guide/article paths, failed dictionary loads, route/search preservation,
RTL overflow at 320/390/768/1024/1440/1920, dictionary request paths, absence
of retired `assets/i18n/` requests, and console cleanliness (the only expected
network error is the local `/api/localize` 503 when the function is
unconfigured).

A synthetic complete-dictionary check (route-intercepted, not stored in the
repo) confirmed that a complete target dictionary now applies site-wide
including in-page UI, that dictionary hits are not re-sent to the content API,
and that English restore removes all injected strings. The same check confirmed
article prose still goes through the API while article UI CTAs use the
dictionary.

Fixes verified during this pass:

- Internal `t()` calls now pass the locale argument; the pending status chip
  and Retry/Dismiss labels no longer render as `[object Object]`.
- The off-screen skip link no longer uses `left:-9999px`; it uses a vertical
  offset so RTL layouts do not gain ~9999 px of horizontal scroll.
- Content translation runs batches sequentially and stops at the first failure,
  so an unavailable backend is not hammered once per batch.

## 8. Pending work

1. Generate and review real translations for the 8 targets
   (`node scripts/i18n-generate.cjs` with `GEMINI_API_KEY`), then let the
   validator refresh `locales/manifest.json`. Do not mark a locale complete
   until every key is reviewed.
2. Deploy and configure `/api/localize` with `GEMINI_API_KEY` (plus a durable
   limiter or `LOCALIZE_REQUIRE_DURABLE_LIMIT=0`); production currently lacks
   the function, and local requests intentionally return 503.
3. Re-run long-string layout/regression tests with the real translations; the
   current mobile/RTL checks use English plus a synthetic prefix.
4. Decide whether to wire the AI panel and the JS-generated strings above into
   the dictionary, or keep them explicitly out of scope.
5. If organic multilingual search matters, design crawlable per-locale routes
   and `hreflang` instead of the current same-URL client-side switch.
