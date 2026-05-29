-- v100：各路好手每日只能發佈 1 場熱推，送出後不可收回/修改。
-- 會先清掉舊重複資料：同一帳號同一天若有多筆熱推，只保留最早送出的那一筆。

create extension if not exists pgcrypto;

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

-- 同帳號、同一天、好手熱推只保留最早一筆
with ranked as (
  select id,
         row_number() over (
           partition by account, match_date
           order by created_at asc, id asc
         ) as rn
  from public.comments
  where comment_type = 'pundit'
    and account is not null
)
delete from public.comments c
using ranked r
where c.id = r.id
  and r.rn > 1;

-- 建立唯一限制：每個帳號每天只能有一筆 pundit 熱推
create unique index if not exists comments_one_pundit_pick_per_user_day_idx
on public.comments(account, match_date)
where comment_type = 'pundit' and account is not null;

alter table public.comments enable row level security;

drop policy if exists "comments_select_public" on public.comments;
drop policy if exists "comments_insert_public" on public.comments;
drop policy if exists "comments_update_public" on public.comments;
drop policy if exists "comments_delete_public" on public.comments;

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

-- 不建立 update/delete policy：前台送出後不能修改、不能收回。

create index if not exists comments_game_type_date_idx on public.comments(game_key, comment_type, match_date, created_at desc);
