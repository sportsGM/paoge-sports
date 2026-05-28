-- v28 後台手動資料表
-- 目的：不要在前台寫死玩家資料，可以直接在 Supabase Table Editor 新增假玩家/熱推。

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

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.manual_sports_ranks to anon, authenticated;
grant select, insert, update, delete on public.hot_picks to anon, authenticated;

alter table public.manual_sports_ranks disable row level security;
alter table public.hot_picks disable row level security;

-- 範例：要製造排行榜人數，可以在 Table Editor 新增，也可以用以下格式新增
-- insert into public.manual_sports_ranks (nickname, month_recommended, month_wins, active) values
-- ('水過仙人', 30, 23, true),
-- ('林口兄弟', 30, 22, true);

-- 範例：首頁今日好手熱推
-- insert into public.hot_picks (nickname, pick, accuracy, comment, sort_order, active) values
-- ('水過仙人', '推 大 8.5', 78, '今日重點看打線火力。', 1, true),
-- ('林口兄弟', '推 老虎 -1.5', 74, '讓分盤可觀察。', 2, true);
