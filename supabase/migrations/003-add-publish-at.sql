-- ==========================================================================
-- Supabase migration 003 — add publish_at for scheduled publishing
-- Safe to run more than once (idempotent).
-- Run with: supabase db push  (or paste into the SQL editor)
-- ==========================================================================

-- Add publish_at column to articles table (idempotent)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'articles'
      and column_name = 'publish_at'
  ) then
    alter table public.articles add column publish_at timestamptz;
  end if;
end $$;

-- Partial index for efficient scheduled-article queries
-- Only indexes draft rows that have a future publish_at
create index if not exists articles_scheduled_idx
  on public.articles (publish_at asc)
  where status = 'draft' and publish_at is not null;

-- Comment for documentation
comment on column public.articles.publish_at is
  'Scheduled publication time. Article stays draft until publish_at <= now(), then becomes published. Null = not scheduled.';
comment on column public.articles.published_at is
  'Actual publication time. Set when article transitions to published. Preserved on unpublish for history.';
