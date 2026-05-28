-- v52 修正：好手熱推 comments / 木魚阿嬤 interaction_counts 權限
-- 到 Supabase SQL Editor 執行一次即可。

grant usage on schema public to anon, authenticated;

create extension if not exists pgcrypto;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  game_key text,
  account text,
  nickname text,
  content text,
  market_pick text,
  comment_type text not null default 'player',
  match_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.comments add column if not exists game_key text;
alter table public.comments add column if not exists account text;
alter table public.comments add column if not exists nickname text;
alter table public.comments add column if not exists content text;
alter table public.comments add column if not exists market_pick text;
alter table public.comments add column if not exists comment_type text not null default 'player';
alter table public.comments add column if not exists match_date date not null default current_date;
alter table public.comments add column if not exists created_at timestamptz not null default now();

create table if not exists public.interaction_counts (
  id uuid primary key default gen_random_uuid(),
  account text,
  nickname text,
  type text not null default 'woodfish',
  interaction_type text,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.interaction_counts add column if not exists account text;
alter table public.interaction_counts add column if not exists nickname text;
alter table public.interaction_counts add column if not exists type text not null default 'woodfish';
alter table public.interaction_counts add column if not exists interaction_type text;
alter table public.interaction_counts add column if not exists count integer not null default 0;
alter table public.interaction_counts add column if not exists updated_at timestamptz not null default now();

create index if not exists comments_game_date_type_idx on public.comments (game_key, match_date, comment_type, created_at desc);
create index if not exists interaction_counts_type_idx on public.interaction_counts (type, account, updated_at desc);
create index if not exists interaction_counts_interaction_type_idx on public.interaction_counts (interaction_type, account, updated_at desc);

grant select, insert, update, delete on public.comments to anon, authenticated;
grant select, insert, update, delete on public.interaction_counts to anon, authenticated;

-- 你的網站目前是 GitHub Pages + anon key 前端直連 Supabase。
-- 為了讓留言與互動一定能寫入，這裡直接關閉這兩張表 RLS。
alter table public.comments disable row level security;
alter table public.interaction_counts disable row level security;

-- 確認
select 'comments ok' as status, count(*) as rows from public.comments
union all
select 'interaction_counts ok' as status, count(*) as rows from public.interaction_counts;
