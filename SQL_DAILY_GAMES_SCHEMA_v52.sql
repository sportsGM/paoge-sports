-- v52 新增：每日賽事同步資料表
-- 用來存 GitHub Actions 每日從玩運彩 / Yahoo 運動 / SofaScore 整理後的賽事與盤口。

create extension if not exists pgcrypto;
grant usage on schema public to anon, authenticated;

create table if not exists public.daily_games (
  id uuid primary key default gen_random_uuid(),
  game_date date not null default current_date,
  sport text not null,
  league text not null,
  game_time text,
  away text not null,
  home text not null,
  money text,
  spread text,
  total text,
  confidence integer[] default array[60,60,60],
  source_url text,
  source_name text,
  analysis_json jsonb default '{}'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique(game_date, league, away, home)
);

create index if not exists daily_games_date_league_idx
on public.daily_games (game_date, league, active, game_time);

grant select, insert, update, delete on public.daily_games to anon, authenticated;
alter table public.daily_games disable row level security;

-- 測試資料：正式排程跑成功後會被每日資料覆蓋。
insert into public.daily_games
(game_date, sport, league, game_time, away, home, money, spread, total, confidence, source_url, source_name, analysis_json, active)
values
(current_date, 'baseball', 'MLB', 'AM 07:40', '天使', '老虎', '老虎勝 ★', '老虎 -1.5', '大 8.5 ★', array[72,62,58], 'https://www.playsport.cc/predict/games?allianceid=1&from=header', '玩運彩', '{"topTitle":"雙方先發","source_note":"盤口以玩運彩預測賽事旁運彩盤為準；棒球顯示先發投手。"}'::jsonb, true)
on conflict (game_date, league, away, home) do update set
  game_time=excluded.game_time,
  money=excluded.money,
  spread=excluded.spread,
  total=excluded.total,
  confidence=excluded.confidence,
  source_url=excluded.source_url,
  source_name=excluded.source_name,
  analysis_json=excluded.analysis_json,
  active=true,
  updated_at=now();
