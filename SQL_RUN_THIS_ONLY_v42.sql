-- v42 正式上線唯一需要執行的 SQL
-- 目的：建立/補齊目前網站需要的 Supabase 資料表、權限、在線人數基數與登入修正。
-- 建議：只跑這個檔案，不要再跑舊版 v28/v30/v32/v33/v40/v41 SQL，避免資料被舊設定覆蓋。

create extension if not exists pgcrypto;

grant usage on schema public to anon, authenticated;

-- 會員資料表
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  account text not null,
  password text not null,
  nickname text,
  line_id text,
  role text not null default '體育萌新',
  month_recommended integer not null default 0,
  month_wins integer not null default 0,
  is_online boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

alter table public.app_users add column if not exists password text;
alter table public.app_users add column if not exists nickname text;
alter table public.app_users add column if not exists line_id text;
alter table public.app_users add column if not exists role text not null default '體育萌新';
alter table public.app_users add column if not exists month_recommended integer not null default 0;
alter table public.app_users add column if not exists month_wins integer not null default 0;
alter table public.app_users add column if not exists is_online boolean not null default false;
alter table public.app_users add column if not exists last_seen timestamptz;
alter table public.app_users add column if not exists created_at timestamptz not null default now();

-- 清除帳號/密碼/暱稱/權限前後空格，修正明明密碼正確卻登入失敗的情況
update public.app_users
set
  account = trim(account),
  password = trim(coalesce(password, '')),
  nickname = trim(coalesce(nickname, account)),
  role = coalesce(nullif(trim(role), ''), '體育萌新')
where account is not null;

-- 留言資料表
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

create index if not exists comments_game_date_type_idx
on public.comments (game_key, match_date, comment_type, created_at desc);

-- 預測資料表
create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  game_key text,
  account text,
  nickname text,
  market_type text,
  pick text,
  line_text text,
  result text not null default 'pending',
  match_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.predictions add column if not exists game_key text;
alter table public.predictions add column if not exists account text;
alter table public.predictions add column if not exists nickname text;
alter table public.predictions add column if not exists market_type text;
alter table public.predictions add column if not exists pick text;
alter table public.predictions add column if not exists line_text text;
alter table public.predictions add column if not exists result text not null default 'pending';
alter table public.predictions add column if not exists match_date date not null default current_date;
alter table public.predictions add column if not exists created_at timestamptz not null default now();

create index if not exists predictions_match_date_idx
on public.predictions (match_date, game_key, account, market_type);

-- 木魚 / 阿嬤互動排行
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

create index if not exists interaction_counts_type_idx
on public.interaction_counts (type, account, updated_at desc);

-- 手動預測排行榜 / 今日熱推舊版相容表
create table if not exists public.manual_sports_ranks (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  month_recommended integer not null default 0,
  month_wins integer not null default 0,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.hot_picks (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  pick text not null,
  accuracy integer default 60,
  comment text,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 舊版 online_stats 相容表，v41 主要改用 online_base_settings
create table if not exists public.online_stats (
  id uuid primary key default gen_random_uuid(),
  role text unique not null,
  min_count integer not null default 0,
  max_count integer not null default 0,
  current_count integer not null default 0,
  active boolean not null default true,
  last_generated_at timestamptz,
  updated_at timestamptz not null default now()
);

-- v41 後台可調整在線人數基數
create table if not exists public.online_base_settings (
  id uuid primary key default gen_random_uuid(),
  role text unique not null,
  morning_base integer not null default 0,
  day_base integer not null default 0,
  night_base integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.online_base_settings (role, morning_base, day_base, night_base, active)
values
  ('體育萌新', 50, 60, 20, true),
  ('一般會員', 10, 50, 30, true),
  ('VIP會員', 100, 250, 80, true),
  ('體育大神', 8, 18, 10, true)
on conflict (role) do update set
  morning_base = excluded.morning_base,
  day_base = excluded.day_base,
  night_base = excluded.night_base,
  active = excluded.active,
  updated_at = now();

-- 重設管理員帳號：不使用 on conflict，避免舊資料庫沒有 account unique 時報錯。
update public.app_users
set password='123456', nickname='砲哥', line_id='@946sjdhg', role='體育大神', month_recommended=30, month_wins=22, is_online=false
where trim(account)='paoge5888';

insert into public.app_users (account, password, nickname, line_id, role, month_recommended, month_wins, is_online)
select 'paoge5888', '123456', '砲哥', '@946sjdhg', '體育大神', 30, 22, false
where not exists (select 1 from public.app_users where trim(account)='paoge5888');

update public.app_users
set password='123456', nickname='龍女', line_id='@yao88', role='體育大神', month_recommended=30, month_wins=21, is_online=false
where trim(account)='yao88';

insert into public.app_users (account, password, nickname, line_id, role, month_recommended, month_wins, is_online)
select 'yao88', '123456', '龍女', '@yao88', '體育大神', 30, 21, false
where not exists (select 1 from public.app_users where trim(account)='yao88');

-- 前端 REST API 權限。正式營運前建議改成 Supabase Auth + RLS 或後端 API。
grant select, insert, update, delete on public.app_users to anon, authenticated;
grant select, insert, update, delete on public.comments to anon, authenticated;
grant select, insert, update, delete on public.predictions to anon, authenticated;
grant select, insert, update, delete on public.interaction_counts to anon, authenticated;
grant select, insert, update, delete on public.manual_sports_ranks to anon, authenticated;
grant select, insert, update, delete on public.hot_picks to anon, authenticated;
grant select, insert, update, delete on public.online_stats to anon, authenticated;
grant select, insert, update, delete on public.online_base_settings to anon, authenticated;

alter table public.app_users disable row level security;
alter table public.comments disable row level security;
alter table public.predictions disable row level security;
alter table public.interaction_counts disable row level security;
alter table public.manual_sports_ranks disable row level security;
alter table public.hot_picks disable row level security;
alter table public.online_stats disable row level security;
alter table public.online_base_settings disable row level security;

-- 最後檢查：如果下面第一段有結果，代表同帳號有多筆舊資料。v42 前端可正常登入，但建議之後手動刪舊資料。
select trim(account) as account, count(*) as duplicate_count
from public.app_users
where account is not null
group by trim(account)
having count(*) > 1;

-- 確認管理員帳號
select account, password, nickname, line_id, role, is_online
from public.app_users
where trim(account) in ('paoge5888','yao88')
order by account;
