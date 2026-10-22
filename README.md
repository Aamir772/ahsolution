# AH SOLUTION — Website (v3)

A premium, cinematic static website for **AH SOLUTION** — a tech channel covering
smartphones, PC tips, live wallpapers, budget gadgets, and safe app recommendations.

Built with **plain HTML, CSS, and vanilla JavaScript** — no build step, no frameworks,
no monthly cost. Hosted on Netlify at **https://ahsolution.live**.

## Design language (v3)
- Cinematic dark canvas (`#07080C`) with graphite surfaces (`#101219` / `#171923`),
  a dual accent system — crimson (`#F52245` / `#F0445E` / `#9D102A`) and electric
  blue (`#16A8FF` / `#63E4FF`) — text `#F5F6FA`, muted `#A9ADBB`.
- Glass navbar with an animated active-link pill; the canonical wordmark lives in
  the navbar, footer, and boot screen (the hero globe is intentionally logo-free).
- A **cinematic 3D planet** hero centerpiece (Three.js WebGL): a procedurally textured
  globe with two-tone rim light (blue/crimson), fresnel atmosphere, tilted orbital rings,
  a starfield and an orbiting tech-chip ring. When WebGL is unavailable it degrades
  gracefully to a canvas-2D planet. Clicking the exact centre of the globe opens
  **SOLUTION AI** (see below). The globe is intentionally logo-free.
- Image-led **category carousel** on the homepage (continuous loop, swipe + arrows).
- On desktop the site renders inside a brushed-metal monitor frame; on mobile it sits
  inside a phone bezel. Both include a full-width escape hatch.
- Separate layouts for **Short-form (9:16 vertical)** and **long-form (16:9)** video.
- Seven-item glass navigation: Home · Videos · Shorts · Blog · Categories · About · Contact.

## Homepage order
Hero → category carousel → YouTube highlights → ad slot → latest videos (16:9) →
Shorts (9:16) → latest blog & guides → ad slot → newsletter + socials → footer.

## Pages
- `index.html` — the ten-section homepage described above.
- `vlogs.html` — data-driven long-form library + dedicated Shorts grid.
- `blog.html` — written guides with category filter + search, plus published
  CMS articles (loaded from the public articles function when configured).
- `article.html` — public CMS article renderer (`?slug=…`, also `/article/…`
  via the Netlify redirect).
- `tutorials.html` — interactive tutorial explorer (written + video items).
- `about.html`, `contact.html`, `privacy.html`, `terms.html`, `404.html`.
- `guides/*.html` — in-depth written guides.
- `admin/login.html`, `admin/dashboard.html`, `admin/editor.html` — the
  Supabase-backed content admin panel (see below).

## Dynamic video data (honest, no fabrication)
Video info comes from the real channel and is **never invented**. Two ways to refresh it:

1. **RSS (default, no key):** `npm run fetch:videos`
   Reads the public channel feed and each watch page. Provides titles, dates,
   thumbnails, views, likes, Shorts detection, and durations.
2. **YouTube Data API (optional):** set `YT_API_KEY` in the environment, then
   `npm run fetch:videos`. Keys stay server-side only and are never shipped to the browser.

Output is written to `assets/data/videos.json`. The site loads it at runtime and keeps an
embedded **fallback snapshot** (clearly labelled "cached") so pages still work offline.

Highlight cards are ranked from public data (total views → "Most watched", likes →
"Most liked", average views since upload → "Trending"). Because the channel's most recent
upload predates today, "Trending" is calculated by velocity, not recency, and the UI says so.

## AdSense-ready (placeholders only)
`.ad-slot` blocks mark clean, labelled advertising positions between content sections.
They are **empty placeholders** — no ad, no ad network script, and no tracking is loaded
until the site is approved and a real publisher code is added.

## SOLUTION AI (homepage assistant)

**SOLUTION AI** is the text + voice assistant built into the homepage. It activates by
clicking the exact centre of the hero globe and is intentionally not added to the navbar,
so there is a single, deliberate entry point.

It is **knowledge-first and cost-controlled**: questions that can be answered from the
site's own content (videos, guides, pages) are answered on-device with **no network call
and no cost**. Only genuinely open-ended questions reach the hosted model, and even then
the server retrieves relevant site passages first and asks the model to answer *only*
from them.

### How it works
```
click globe centre  ->  assets/js/ai.js  (panel, chat, retrieval, voice, i18n)
                          |
                          |-- lookup intent / offline / AI off  ->  local answer (0 cost)
                          |
                          `-- open question -> POST /.netlify/functions/solution-ai-chat
                                                    |
                                       netlify/functions/solution-ai-chat.js
                                                    |
                              retrieve site passages -> call provider (Gemini/OpenAI-compatible)
                                                    `-- provider failure -> knowledge fallback
```
- `assets/data/ai-index.json` — client-side search index (pages, guides, videos).
- `netlify/functions/_shared/ai-index.json` — the same index bundled with the function.
- Both are generated by `npm run build:index` (no dependencies, Node built-ins only).
- The API key is read **only** server-side (`process.env.AI_API_KEY`) and is never sent to
  the browser or included in any response.

### Voice
- **Input:** the browser Speech Recognition API (`en-IN` / `hi-IN`); the mic button is
  hidden automatically on browsers without support.
- **Output:** the browser Speech Synthesis API, with a read-aloud toggle and a language
  selector (English / Hindi). Both are free and run entirely on the client.

### Configuration (Netlify environment variables)
| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `gemini` | `gemini` (default) or `openai` (any OpenAI-compatible endpoint). |
| `AI_API_KEY` | — | Provider API key. **Required** for hosted answers; keep it secret. |
| `AI_MODEL` | `gemini-2.5-flash` | Model name for the selected provider. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Base URL when `AI_PROVIDER=openai` (Groq/OpenRouter/etc.). |
| `AI_DISABLED` | `0` | Set `1` to force knowledge-only mode regardless of key. |
| `AI_REQUIRE_DURABLE_LIMIT` | `1` | When `1`, hosted AI stays **off** until a durable limiter (Upstash) is configured. |
| `UPSTASH_REDIS_REST_URL` | — | Upstash Redis REST URL — enables the durable rate limiter. |
| `UPSTASH_REDIS_REST_TOKEN` | — | Upstash Redis REST token. |
| `ALLOWED_ORIGINS` | — | Extra allowed origins, comma-separated (defaults include the live site + localhost). |
| `SITE_URL` | `https://ahsolution.live` | Canonical site URL used for absolute links in answers. |
| `AI_RATE_LIMIT` | `10` | Requests per window. |
| `AI_RATE_WINDOW_MS` | `600000` | Rate-limit window (10 minutes). |
| `AI_DAILY_LIMIT` | `40` | Requests per day. |
| `AI_MAX_OUTPUT_TOKENS` | `450` | Max tokens per model reply. |

**Safety default:** with no configuration at all the assistant still works in
**knowledge-only mode** (site answers, zero cost, no key). To enable hosted answers you
must set a key **and** a durable rate limiter (or explicitly set
`AI_REQUIRE_DURABLE_LIMIT=0`, not recommended for production).

### Cost & limits
- Client short-circuits lookup questions → typically no per-question cost.
- Server retrieves top site passages, then asks the model; replies are capped at
  `AI_MAX_OUTPUT_TOKENS` (450).
- Messages are limited to 800 characters; request bodies over 12 KB are rejected; the
  model call has a 12 s timeout; answers are cached for 24 h (200 entries).
- Rate limits apply both **per window** and **per day** (in-memory by default, durable
  via Upstash). In-memory limits reset on cold start — configure Upstash for production.
- Logs contain only method, status, latency, and a **hashed** IP — never user text.

### Local testing
```
npm run build:index   # (re)generate assets/data/ai-index.json + the function copy
npm run test:ai       # 26 unit tests for the function (no network, providers mocked)
npm run qa:ai         # 40 end-to-end checks (requires the site on http://localhost:8000)
```
`qa:ai` needs a static server running (`npm run serve`) and a local Chromium (Playwright).

### Limitations
- Voice relies on browser APIs: best support in Chrome/Edge; the mic is hidden elsewhere.
- On-page speech recognition quality depends on the browser and microphone.
- The in-memory rate limiter is not durable across serverless cold starts — configure
  Upstash before relying on hosted AI in production.
- Verify current model availability and free-tier terms for your chosen provider before
  enabling.

## Project structure
```
/                HTML pages + article.html + robots.txt + sitemap.xml + netlify.toml + site.webmanifest
/admin           login.html + dashboard.html + editor.html + admin.css + admin.js (CMS panel)
/assets/css      tokens.css (design tokens) + styles.css + device.css + ai.css
/assets/js       main.js + globe.js + ai.js + device.js + cms.js (public CMS client)
/assets/data     videos.json + ai-index.json (generated for SOLUTION AI)
/assets/vendor   three.module.min.js (vendored Three.js ESM — no CDN, no build step)
/assets/img      favicons, og-default.jpg + deco/ (locally generated Haikei-style SVGs)
/netlify/functions  solution-ai-chat.js + articles/ + admin-auth/ + upload-cover/ + init-admin/
                    (+ _shared/supabase-rest.cjs — zero-dependency Supabase helpers)
/supabase        migrations/001-articles.sql (schema, RLS, storage bucket)
/scripts         build-deco.mjs + fetch-videos.mjs + build-ai-index.mjs
                 + ai-function-test.mjs + ai-qa.cjs
                 + qa-lib.cjs + qa-device.cjs + qa-pages.cjs + qa-scroll.cjs + qa-admin.cjs
/guides          long-form written guides
```

## Local development
```
npm start             # serve at http://localhost:8000  (any static server works)
npm run serve         # alternative static server (npx serve)
npm run build:deco    # regenerate the local SVG decoration set
npm run fetch:videos  # regenerate assets/data/videos.json
npm run build:index   # regenerate the SOLUTION AI index (client + function copies)
npm run test:ai       # unit-test the SOLUTION AI function
npm run qa:ai         # end-to-end QA for the hero globe + SOLUTION AI
npm run qa:device     # device frame + boot sequence QA
npm run qa:pages      # every public page at desktop + 320/360/390/430px
npm run qa:scroll     # scroll reveals, search modal, blog filter, mobile nav
npm run qa:admin      # CMS functions against a local mock Supabase (no browser)
npm run qa            # the full browser suite + admin function suite
```

No dependencies are required to run the site. The build/QA scripts use only Node's
built-in modules; the end-to-end QA additionally expects a local Chromium (Playwright).

## Admin panel & CMS (Supabase + Netlify Functions)
A secure, function-backed CMS for managing articles. **Every privileged operation goes
through a Netlify Function** which verifies a Supabase *user* JWT server-side and checks
the email against an administrator allowlist. The service-role key never leaves the
server, and the browser never holds any key at all — not even the anon key.

```
browser (admin/*.html + admin.js)
   |  POST /.netlify/functions/admin-auth      {action:'login'|'refresh'|'me'}
   |  POST /.netlify/functions/articles        {action:'list'|'create'|'update'|...}
   |  POST /.netlify/functions/upload-cover    {filename, contentType, dataBase64}
   v
Netlify Functions  (verify Bearer token -> GoTrue /auth/v1/user, ADMIN_EMAILS check)
   v
Supabase (GoTrue auth + PostgREST articles + Storage covers bucket)

public site (article.html + cms.js)
   |  GET  /.netlify/functions/articles?action=list[&slug=…]
   v
same function, published rows only (no auth, no keys in the browser)
```

### 1. Setup
1. **Create a Supabase project** at <https://supabase.com>. Note the project URL,
   publishable (anon) key, and service-role key.
2. **Run the migration** `supabase/migrations/001-articles.sql` (SQL editor or CLI).
   It creates the `articles` + `admins` tables, indexes, the `increment_view` RPC,
   Row Level Security (public read of `status='published'` only), and the public-read
   `covers` storage bucket with its policies.
3. **Enable Auth → email/password** sign-in. Disable public sign-ups; the first
   administrator is created by the `init-admin` function.
4. **Set the environment variables** in the Netlify dashboard (see `.env.example`):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ADMIN_EMAILS`, `ADMIN_SETUP_TOKEN`, and optionally `ALLOWED_ORIGINS`.

### 2. Initial administrator
With `ADMIN_SETUP_TOKEN` set, run once:
```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ADMIN_SETUP_TOKEN=… \
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=at-least-10-chars \
npm run admin:init
```
or `POST /.netlify/functions/init-admin` with
`Authorization: Bearer <ADMIN_SETUP_TOKEN>` and body
`{ "email": "you@example.com", "password": "at-least-10-chars" }`.
This creates the Supabase user (confirmed, `app_metadata.role=admin`), records it in the
`admins` table, and is idempotent. Then open `/admin/login.html` and sign in.
**Unset `ADMIN_SETUP_TOKEN` afterwards to disable bootstrapping.**

### 3. The admin panel
| Page | What it does |
|---|---|
| `/admin/login.html` | Password sign-in via the `admin-auth` function (the anon key stays server-side). Silent refresh + allowlist enforcement. |
| `/admin/dashboard.html` | Article table with search + status filter, publish / unpublish / delete / edit actions, view counts. |
| `/admin/editor.html` | Zero-dependency rich editor (`contenteditable` + `execCommand` toolbar): title, auto-slug, excerpt, category chips, tags, SEO description with a live search preview, cover upload/URL, draft autosave to `localStorage`, Ctrl/Cmd+S. |

All three share `admin/admin.js` (session + typed API client + DOM helpers) and
`admin/admin.css` (built on the same design tokens as the public site). The panel
sends `noindex` headers (see `netlify.toml`).

### 4. Articles API (`netlify/functions/articles`)
| Method | Action | Auth | Behaviour |
|---|---|---|---|
| GET | `list` (`&limit`, `&offset`, `&category`, `&slug`) | public | Published rows only. A `slug` request returns the single article (and bumps `view_count`). |
| POST | `list` | admin | All statuses, for the dashboard. |
| POST | `create` | admin | Server-sanitised insert; slug auto-generated + uniqueness enforced; `published_at` stamped when published. |
| POST | `update` | admin | Partial update; omitting the slug preserves it; slug uniqueness re-checked. |
| POST | `publish` / `unpublish` | admin | Status flip with `published_at` handling. |
| POST | `delete` | admin | Requires `confirm: true`. |

Admin writes are authorised by verifying the Bearer JWT against GoTrue and matching
`ADMIN_EMAILS` (fallback: the `role=admin` claim in `app_metadata`). Bodies are passed
through an allowlist HTML sanitiser — scripts, iframes, event handlers and
`javascript:` URLs never reach the database.

### 5. Media (Supabase Storage)
`POST /.netlify/functions/upload-cover` (admin-verified) writes to the public-read
`covers` bucket (created by the migration) and returns the public URL. Accepted types:
jpeg / png / webp / avif, max 3 MB. The editor also accepts a pasted image URL.

### 6. Public CMS pages
- `assets/js/cms.js` — keyless client for the public GET endpoint.
- `article.html?slug=…` (or `/article/…` via redirect) — renders one published article:
  cover, body, reading time, share row, related articles, updated meta/OG/JSON-LD,
  graceful loading/not-found states.
- `blog.html` — published CMS articles are prepended into the guide grid and participate
  in the existing category filter + search.
- If the backend is not configured, both pages silently keep their static content —
  the CMS is strictly additive.

### 7. Testing the CMS locally
```
npm run qa:admin    # 72 function-level checks against a local mock Supabase
                    # (auth gating, CRUD, sanitiser, uploads, init-admin, secret hygiene)
```
No real Supabase project, browser, or network access is required.

### 8. Cost & limitations
- **Supabase Free tier** and **Netlify Functions free tier** comfortably cover a
  low-traffic editorial site.
- `init-admin` enforces a 10-character minimum but not a full password policy.
- Cover uploads go through the function as base64 (fine for ≤3 MB covers; not intended
  for large media libraries).
- The view counter uses a Postgres RPC and is best-effort — a failed increment never
  breaks a read.
- **Never commit `.env` files or expose `SUPABASE_SERVICE_ROLE_KEY`** in any client
  repository or deployment artifact.

## Global language selector & Gemini localization

The public site ships an accessible language selector in the header (desktop
and mobile; the site's canonical copy stays the default for everyone — **no**
IP/geo auto-detection, no language flash on first paint).

### Locale model (10 configured locales)
- **`hinglish`** — the site's existing canonical mixed-language copy, extracted
  verbatim into `assets/i18n/locales/hinglish.json`. It is the source of truth;
  existing content is never rewritten, normalized, or translated during
  initialization.
- **9 translation targets:** `hi` Hindi, `bn` Bengali, `ta` Tamil, `te` Telugu,
  `mr` Marathi, `gu` Gujarati, `kn` Kannada, `ml` Malayalam, `pa` Punjabi.
- **HTML tagging limitation:** Hinglish has no standard BCP47 locale. When
  `hinglish` is explicitly selected the runtime sets a private-use tag
  (`en-IN-x-hinglish`) on `<html lang>`; this is best-effort metadata — HTML
  language tags cannot precisely represent mixed Hinglish text. The default
  copy keeps `lang="en"` / `lang="en-IN"` as authored.

### Separation of generation and runtime (important)
- **Generation (offline, controlled):** `node scripts/i18n-generate.cjs` reads
  `GEMINI_API_KEY` from the local environment only, calls the **Gemini API**'
  (`gemini-2.5-flash` by default, `LOCALIZE_MODEL` override), validates every
  batch (count, non-empty strings, `{placeholder}` preservation, brand term
  preservation, untrusted-data prompt), and writes the validated result to
  `assets/i18n/locales/<locale>.json` with `meta.complete: true` — only when
  **all** keys are translated. A rejected batch aborts the run without
  partial writes.
- **Validation:** `node scripts/i18n-validate.cjs` reports and enforces
  missing/extra/duplicate keys, empty values, placeholder drift, meta
  truthfulness, and rejects untruthful `complete` flags.
- **Runtime (production):** locale switches for UI strings load the local
  JSON dictionaries — **zero API calls for interface strings**. Only
  article/video/dynamic content is translated on demand through the secure
  backend endpoint, with caching and fallback to the canonical copy.
- **Pending locales:** a dictionary with `meta.complete: false` (initial
  state for the 9 targets until generation runs with a key) falls back to the
  canonical copy for UI strings and is never presented as a finished
  translation; article/content translation on demand remains available.

### On-demand content translation (Gemini, server-side only)
- **Endpoint:** `/api/localize` (rewrite to `netlify/functions/localize`).
  `GET` → status/config (10 locales, 9 targets); `POST` →
  `{ lang, items: [string, …] }` → translated strings. Targets only
  (`hinglish` and the default copy are never "translated into themselves").
- **Model:** `gemini-2.5-flash` (fixed, documented; override with
  `LOCALIZE_MODEL`). Frontend requests can never change the model.
- **Key handling:** set `GEMINI_API_KEY` in the Netlify dashboard (Site →
  Environment variables) or locally via `.env` (git-ignored). It is read only
  server-side — never in frontend JavaScript, HTML, or committed files.
- **Scope:** article bodies, cards, video titles/descriptions, alt text,
  captions. Code blocks, commands, URLs, the admin panel, and the SOLUTION AI
  widget are never translated. SEO URLs and canonical metadata stay as
  authored (the static HTML files are never modified at runtime).
- **Caching:** server keeps a small per-instance cache (24 h); the browser
  keeps the persistent cache in `localStorage` keyed by target locale + exact
  source text — a source-content change misses the cache automatically. No
  extra paid dependency is used for caching.
- **Rate limiting:** per-IP limiter (Upstash when configured, otherwise a
  best-effort in-memory limiter). Safety default `LOCALIZE_REQUIRE_DURABLE_LIMIT=1`
  keeps on-demand translation disabled until a durable limiter exists; set it
  to `0` once Upstash is configured (or to run with the in-memory limiter
  only).
- **Failure behavior:** missing key / no durable limiter → friendly notice and
  unchanged canonical content (never fake translations). Rate limit, upstream
  errors, timeouts, and malformed responses → clear status chip with retry.
- **RTL:** the runtime flips `dir`/`lang` for any RTL locale (`meta.dir`);
  code stays LTR and decorative art is unchanged.
