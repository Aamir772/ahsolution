-- Migration 004 (prepared, NOT applied): build/deployment status tracking
-- Safe to run more than once.
create table if not exists public.build_status (
  id uuid primary key default gen_random_uuid(),
  trigger_id text,
  reason text,
  article_id uuid,
  requested_by text,
  status text not null default 'requested', -- requested|accepted|running|succeeded|failed|unknown
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  details jsonb default '{}'::jsonb
);
create index if not exists build_status_requested_idx on public.build_status (requested_at desc);
alter table public.build_status enable row level security;
-- no public policies; service role only