-- ==========================================================================
-- Supabase migration 001 — AH Solution articles & content management
-- Run with: supabase db push   (or paste into the SQL editor)
--
-- Design notes
--   * All writes happen in Netlify Functions with the service-role key,
--     which bypasses RLS. The anon key is never shipped to the browser.
--   * Row Level Security therefore only has to allow public SELECT of
--     published rows; drafts stay invisible even if a key leaks.
--   * Cover images live in the public "covers" storage bucket.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- articles — core content type for the blog / guide system
-- --------------------------------------------------------------------------
create table if not exists public.articles (
  id              uuid primary key default gen_random_uuid(),
  slug            varchar(100) not null unique,
  title           varchar(200) not null,
  excerpt         varchar(400) default '',
  body            text default '',              -- sanitised HTML
  cover_image_url varchar(400) default '',
  category        varchar(50) default '',
  tags            varchar(200) default '',      -- comma separated
  status          varchar(20) not null default 'draft'
                    check (status in ('draft', 'published', 'archived')),
  seo_description varchar(300) default '',
  reading_minutes integer not null default 1,
  author_email    varchar(200),
  view_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz
);

create index if not exists articles_status_idx        on public.articles (status);
create index if not exists articles_category_idx      on public.articles (category);
create index if not exists articles_published_at_idx  on public.articles (published_at desc nullslast);
create index if not exists articles_created_at_idx    on public.articles (created_at desc);

-- keep updated_at honest
create or replace function public.articles_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists articles_touch_updated_at on public.articles;
create trigger articles_touch_updated_at
  before update on public.articles
  for each row execute function public.articles_touch_updated_at();

-- view counter (called from the public article endpoint)
create or replace function public.increment_view(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.articles set view_count = view_count + 1 where id = p_id;
$$;

-- --------------------------------------------------------------------------
-- simple taxonomy (optional; the articles.tags text column is enough day to day)
-- --------------------------------------------------------------------------
create table if not exists public.content_categories (
  id          uuid primary key default gen_random_uuid(),
  name        varchar(80) not null unique,
  slug        varchar(80) not null unique,
  description text default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.content_tags (
  id         uuid primary key default gen_random_uuid(),
  word       varchar(40) not null unique,
  lower_word varchar(40) not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.article_tags (
  article_id uuid not null references public.articles(id) on delete cascade,
  tag_id     uuid not null references public.content_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (article_id, tag_id)
);

-- --------------------------------------------------------------------------
-- admin registry (mirrors Supabase Auth; used for auditing)
-- --------------------------------------------------------------------------
create table if not exists public.admins (
  id         uuid primary key,                 -- supabase auth user id
  email      varchar(200) not null unique,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Row Level Security
--   anon     -> may only read published articles
--   authenticated -> same as anon (writes always go through the service role)
--   service_role  -> bypasses RLS entirely
-- --------------------------------------------------------------------------
alter table public.articles           enable row level security;
alter table public.content_categories enable row level security;
alter table public.content_tags       enable row level security;
alter table public.article_tags       enable row level security;
alter table public.admins             enable row level security;

drop policy if exists "public read published" on public.articles;
create policy "public read published"
  on public.articles for select
  using (status = 'published');

drop policy if exists "public read categories" on public.content_categories;
create policy "public read categories" on public.content_categories for select using (true);

drop policy if exists "public read tags" on public.content_tags;
create policy "public read tags" on public.content_tags for select using (true);

drop policy if exists "public read article tags" on public.article_tags;
create policy "public read article tags" on public.article_tags for select using (true);

-- increment_view is security definer, so anon can call it
grant execute on function public.increment_view(uuid) to anon, authenticated;

-- --------------------------------------------------------------------------
-- Storage: public "covers" bucket for article cover images
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists "covers public read" on storage.objects;
create policy "covers public read"
  on storage.objects for select
  using (bucket_id = 'covers');

-- only the service role (i.e. the admin functions) may write
drop policy if exists "covers service write" on storage.objects;
create policy "covers service write"
  on storage.objects for insert to service_role
  with check (bucket_id = 'covers');

drop policy if exists "covers service update" on storage.objects;
create policy "covers service update"
  on storage.objects for update to service_role
  using (bucket_id = 'covers');

drop policy if exists "covers service delete" on storage.objects;
create policy "covers service delete"
  on storage.objects for delete to service_role
  using (bucket_id = 'covers');
