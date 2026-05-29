-- v74 美國聯盟昨日/今日分流修正
-- 目的：避免 MLB / NBA / WNBA 的 gameday=today 與 gameday=tomorrow 因為同一組隊伍覆蓋到彼此。
-- 必跑一次。之後 daily_games 會用 game_day_type 分開儲存：
-- MLB/NBA/WNBA：yesterday = 玩運彩 gameday=today；today = 玩運彩 gameday=tomorrow。

alter table public.daily_games add column if not exists game_day_type text default 'today';
alter table public.daily_games add column if not exists game_status text default 'upcoming';
alter table public.daily_games add column if not exists analysis_json jsonb default '{}'::jsonb;
alter table public.daily_games add column if not exists active boolean default true;
alter table public.daily_games add column if not exists updated_at timestamptz default now();

-- 移除同一日期、同一 day_type、同一聯盟、同一場賽事的重複資料，保留最新一筆。
with ranked as (
  select
    id,
    row_number() over (
      partition by game_date, game_day_type, league, away, home, game_time
      order by updated_at desc nulls last, id
    ) as rn
  from public.daily_games
)
delete from public.daily_games d
using ranked r
where d.id = r.id
  and r.rn > 1;

-- 移除舊版只用 game_date + league + away + home 的唯一限制，避免 yesterday/today 互相覆蓋。
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'daily_games_game_date_league_away_home_key'
      and conrelid = 'public.daily_games'::regclass
  ) then
    alter table public.daily_games drop constraint daily_games_game_date_league_away_home_key;
  end if;
exception when others then
  raise notice 'old constraint not dropped or not found: %', sqlerrm;
end $$;

drop index if exists public.daily_games_unique_game_date_league_away_home_idx;
drop index if exists public.daily_games_v74_unique_idx;

create unique index if not exists daily_games_v74_unique_idx
on public.daily_games (game_date, game_day_type, league, away, home, game_time);

-- 清掉舊版可能被覆蓋、日期分類錯亂的美國聯盟 active 狀態，下一次 workflow 會重新寫入乾淨資料。
update public.daily_games
set active = false,
    updated_at = now()
where league in ('MLB','NBA','WNBA')
  and game_date >= current_date - interval '2 days';

-- 確保前台可讀
alter table public.daily_games enable row level security;
drop policy if exists "daily_games_select_all" on public.daily_games;
create policy "daily_games_select_all"
on public.daily_games
for select
to anon, authenticated
using (true);

grant usage on schema public to anon, authenticated;
grant select on public.daily_games to anon, authenticated;
