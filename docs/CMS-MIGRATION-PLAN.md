# CMS Legacy Migration Plan (Phase 2E — prepared, not executed against production)

## Scope
Migrate existing Markdown articles (`blog/articles/*.md`, 22 files) + `blog/blog-manifest.json` (22 records) to Supabase `articles` without losing content/URLs.

## Safety
- **No production migration executed.**
- Source Markdown and manifest **must remain intact** (rollback). Script never deletes source files.
- Creates timestamped backup + checksums + machine-readable report per run under `scripts/migration-backups/`.
- Idempotent by slug. Existing published DB records are preserved by default (skipped) to avoid accidental overwrite.

## Dry run (zero DB writes)
```bash
node scripts/migrate-legacy-articles.cjs --dry-run
```
Reports create/update/skip/invalid/duplicate counts, parses all source articles, validates slugs/files. Requires no DB creds for parse-only path (DB compare skipped if creds absent).

## Execution (explicit confirmation required)
```bash
node scripts/migrate-legacy-articles.cjs --execute --confirm "MIGRATE LEGACY ARTICLES"
```
- Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- Upserts by slug; inserts missing; does **not** overwrite existing published rows by default.
- **Do not run in production without authorization, backup, and post-migration validation.**

## Latest local dry-run evidence
- Mode: dry-run, source: 22, create: 22, update: 0, skip: 0, invalid: 0, duplicate: 0 (zero DB writes).
- Note: `article_file` paths in manifest include `blog/articles/` prefix; migration script normalizes path.

## Validation after execution
- Count rows vs manifest; no duplicates by slug.
- Compare title/slug/body/cover/category/tags/status/published_at for samples.
- Verify canonical URLs remain `https://ahsolution.live/article/<slug>/`.
- Generate static pages in DB mode in a safe environment and compare key outputs.

## Rollback
- Restore DB backup if needed.
- Keep manifest build active until verified.
- Original Markdown/manifest remain source-of-truth fallback.
