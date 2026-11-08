-- ==========================================================================
-- Supabase migration 002 — add new_until column for NEW badge/filter
-- Safe to run more than once (idempotent).
-- Run with: supabase db push  (or paste into the SQL editor)
-- ==========================================================================

-- Add new_until column to articles table (idempotent)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'articles'
      and column_name = 'new_until'
  ) then
    alter table public.articles add column new_until timestamptz;
  end if;
end $$;

-- Index for efficient NEW filter queries
create index if not exists articles_new_until_idx
  on public.articles (new_until desc nullslast);

-- Comment for documentation
comment on column public.articles.new_until is
  'Articles with new_until > now() display a NEW badge and appear in the New filter. Null = not new.';
