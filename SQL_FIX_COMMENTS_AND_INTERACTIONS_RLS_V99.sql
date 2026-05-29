-- v99：修正木魚 / 阿嬤未登入不寫入、互動與各路好手留言 RLS 權限
create extension if not exists pgcrypto;

-- 木魚 / 阿嬤互動表
create table if not exists public.interaction_counts (
  id uuid primary key default gen_random_uuid(),
  account text not null,
  nickname text,
  type text,
  interaction_type text,
  count integer not null default 0,
  updated_at timestamptz default now()
);

alter table public.interaction_counts add column if not exists id uuid default gen_random_uuid();
alter table public.interaction_counts add column if not exists account text;
alter table public.interaction_counts add column if not exists nickname text;
alter table public.interaction_counts add column if not exists type text;
alter table public.interaction_counts add column if not exists interaction_type text;
alter table public.interaction_counts add column if not exists count integer default 0;
alter table public.interaction_counts add column if not exists updated_at timestamptz default now();

update public.interaction_counts
set type = coalesce(type, interaction_type),
    interaction_type = coalesce(interaction_type, type),
    count = coalesce(count, 0),
    updated_at = coalesce(updated_at, now());

alter table public.interaction_counts enable row level security;

drop policy if exists "interaction_counts_select_public" on public.interaction_counts;
drop policy if exists "interaction_counts_insert_public" on public.interaction_counts;
drop policy if exists "interaction_counts_update_public" on public.interaction_counts;

create policy "interaction_counts_select_public"
on public.interaction_counts
for select
to anon, authenticated
using (true);

create policy "interaction_counts_insert_public"
on public.interaction_counts
for insert
to anon, authenticated
with check (true);

create policy "interaction_counts_update_public"
on public.interaction_counts
for update
to anon, authenticated
using (true)
with check (true);

-- 玩家留言 / 各路好手留言表
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  game_key text,
  account text,
  nickname text,
  content text,
  market_pick text,
  comment_type text default 'player',
  match_date date default current_date,
  created_at timestamptz default now()
);

alter table public.comments add column if not exists id uuid default gen_random_uuid();
alter table public.comments add column if not exists game_key text;
alter table public.comments add column if not exists account text;
alter table public.comments add column if not exists nickname text;
alter table public.comments add column if not exists content text;
alter table public.comments add column if not exists market_pick text;
alter table public.comments add column if not exists comment_type text default 'player';
alter table public.comments add column if not exists match_date date default current_date;
alter table public.comments add column if not exists created_at timestamptz default now();

alter table public.comments enable row level security;

drop policy if exists "comments_select_public" on public.comments;
drop policy if exists "comments_insert_public" on public.comments;
drop policy if exists "comments_update_public" on public.comments;

create policy "comments_select_public"
on public.comments
for select
to anon, authenticated
using (true);

create policy "comments_insert_public"
on public.comments
for insert
to anon, authenticated
with check (true);

-- 只允許更新自己的留言，通常前台目前不會用到；先開著方便之後編輯功能。
create policy "comments_update_public"
on public.comments
for update
to anon, authenticated
using (true)
with check (true);

create index if not exists comments_game_type_date_idx on public.comments(game_key, comment_type, match_date, created_at desc);
create index if not exists interaction_counts_type_idx on public.interaction_counts(type, interaction_type, updated_at desc);
