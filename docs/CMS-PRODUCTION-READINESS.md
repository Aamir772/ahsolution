# CMS Production Readiness (prepared locally — no production changes applied)

## Status
- **Not production-ready for live DB migration/deploy** without external configuration and explicit authorization.
- Code, tests, scripts, and docs prepared locally. **No migrations applied. No prod env vars changed. No deployment performed.**

## Required external configuration (user authorization required)
1. **Supabase**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (if used client-side patterns exist — verify), create/configure storage buckets (`covers`, `images`) with policies matching migrations/app expectations.
2. **Admin access**: `ADMIN_EMAILS`; create first admin user in Supabase Auth.
3. **Netlify**: `NETLIFY_BUILD_HOOK_URL` (server-side only). Optional build/deploy status API credentials if status polling is implemented (must remain server-side).
4. **Apply migrations in order** (after backup/approval): `001-articles.sql`, `002-add-new-until.sql`, `003-add-publish-at.sql`, `004-build-status.sql` (prepared). Verify RLS, RPC `increment_view`, storage policies.

## Migration checklist (exact order)
1. Backup database + storage.
2. Apply `001` (base schema/storage/RLS).
3. Apply `002` (`new_until`).
4. Apply `003` (`publish_at`, scheduled index).
5. Apply `004` (`build_status`) if build tracking table is adopted.
6. Verify: public reads only published/non-future; service role writes; admin functions work; `increment_view` RPC exists.

## Netlify/build
- Current `netlify.toml` build command runs AI index only; `scripts/build-production.cjs` runs AI index + blog build + RSS. **Production switch to DB mode** requires setting `BLOG_SOURCE=db` and using `node scripts/build-production.cjs` only after Supabase is configured and migration verified.
- **No silent fallback**: DB mode throws if Supabase missing/fails (blog build/rss updated). Manifest rollback remains available with `BLOG_SOURCE=manifest`.
- Scheduled function `publish-scheduled` configured (`*/15 * * * *`, Netlify cadence/plan dependent) — publishes due drafts idempotently and triggers build hook. Document/verify actual execution interval in Netlify.

## Build status tracking
- `publish-trigger` returns **202 accepted** (not deployed). Message states async completion.
- Dedup is per-instance/in-memory (email+reason, 5 min) — may suppress rapid distinct publishes in same window and is not durable across instances. **Limitation documented**; improve with durable store/DB row when production DB is available.
- No Netlify deploy-status polling implemented with API token in this local pass; **do not claim deployment confirmed**. Dashboard should treat 202 as “build requested/accepted”.

## Security checklist
- Service-role key never sent to browser; privileged ops in Netlify Functions.
- Admin JWT verified server-side (`requireAdmin`).
- Client cannot set `status/published_at/publish_at` in create/update (dedicated actions only).
- HTML sanitized server-side (`sanitizeHtml` allowlist; `h1` now allowed for compatibility) and client import sanitized with allowlist.
- Upload validation: auth required, MIME allowlist + magic-byte checks, SVG/XML rejected, safe filenames, size limits.
- SRI verified for mammoth/pdf.js main scripts; pdf.js worker hash verified but worker loaded via API (integrity not enforceable the same way).
- Rate limits exist (best-effort, per-instance). Durable rate limiting requires shared store.
- Review RLS/storage policies before go-live.

## Rollback
- Keep `blog/articles/*.md`, `blog/blog-manifest.json`, generated static pages until DB build verified.
- Manifest build: `node scripts/blog-build.js` / `BLOG_SOURCE=manifest`.
- DB build: `node scripts/build-production.cjs` with `BLOG_SOURCE=db` (fails safely if misconfigured).
- DB rollback: restore DB backup; revert env/build source to manifest. Do not delete legacy files.

## Go-live (requires explicit authorization)
- [ ] Backups complete
- [ ] Env vars set in Netlify
- [ ] Migrations applied/verified
- [ ] Admin user created
- [ ] Storage buckets/policies verified
- [ ] Build hook verified
- [ ] Staging/preview validation
- [ ] Switch build to DB mode
- [ ] Monitor build/deploy status manually until API tracking is verified
