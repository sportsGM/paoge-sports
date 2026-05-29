-- v70 Raw Data Center 正式版
-- 目的：先把抓到的原始賽事/對戰/球隊資料完整存起來，再由 Supabase 統一整理給前台使用。

-- daily_games 補欄位：v65 之後通常已經有；這裡保險補齊。
alter table public.daily_games add column if not exists game_day_type text default 'today';
alter table public.daily_games add column if not exists game_status text default 'upcoming';
alter table public.daily_games add column if not exists analysis_json jsonb default '{}'::jsonb;
alter table public.daily_games add column if not exists active boolean default true;
alter table public.daily_games add column if not exists updated_at timestamptz default now();

create table if not exists public.raw_sports_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text default 'github_actions',
  version text,
  status text,
  message text,
  total_games integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.raw_sports_games (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.raw_sports_sync_runs(id) on delete cascade,
  game_date date,
  game_day_type text,
  game_status text,
  sport text,
  league text,
  game_time text,
  away text,
  home text,
  source_url text,
  raw_text text,
  parsed_json jsonb default '{}'::jsonb,
  normalized boolean default false,
  created_at timestamptz default now()
);

create index if not exists raw_sports_games_run_idx on public.raw_sports_games(run_id);
create index if not exists raw_sports_games_lookup_idx on public.raw_sports_games(game_date, game_day_type, league, away, home);

-- 前台讀取權限
alter table public.daily_games enable row level security;
alter table public.raw_sports_sync_runs enable row level security;
alter table public.raw_sports_games enable row level security;

drop policy if exists "daily_games_select_all" on public.daily_games;
create policy "daily_games_select_all" on public.daily_games for select to anon, authenticated using (true);

drop policy if exists "raw_sports_sync_runs_select_all" on public.raw_sports_sync_runs;
create policy "raw_sports_sync_runs_select_all" on public.raw_sports_sync_runs for select to anon, authenticated using (true);

drop policy if exists "raw_sports_games_select_all" on public.raw_sports_games;
create policy "raw_sports_games_select_all" on public.raw_sports_games for select to anon, authenticated using (true);

-- service_role 透過 REST 寫入，不受 RLS 限制；仍補 grant 以免專案權限較嚴。
grant usage on schema public to anon, authenticated;
grant select on public.daily_games to anon, authenticated;
grant select on public.raw_sports_sync_runs to anon, authenticated;
grant select on public.raw_sports_games to anon, authenticated;

-- 統整 function：目前先做安全二次清理，不讓 raw_text 直接污染 ERA/WHIP 等欄位。
-- 之後若要加 Yahoo 精準欄位，可以只改這個 function，不用一直改前台。
create or replace function public.normalize_raw_sports_games_v70(p_run_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_count integer := 0;
begin
  -- 標記本次 raw 已進入統整流程。
  update public.raw_sports_games
  set normalized = true
  where run_id = p_run_id;

  get diagnostics v_count = row_count;

  -- 移除前幾版可能殘留的資料來源字樣。
  update public.daily_games
  set analysis_json = coalesce(analysis_json, '{}'::jsonb)
    #- '{source_note}'
    #- '{data_sources}',
      updated_at = now()
  where updated_at > now() - interval '3 hours';

  return jsonb_build_object('ok', true, 'normalized_raw_rows', v_count);
end;
$$;

-- v70 清理：不要讓前幾版錯誤資料繼續出現。
update public.daily_games
set active = false,
    updated_at = now()
where away ~* '(^| )\d+\s*(vs|v\.s\.)|\bS\.\s*\d'
   or home ~* '(^| )\d+\s*(vs|v\.s\.)|\bS\.\s*\d'
   or away ilike '%戰資訊%'
   or home ilike '%戰資訊%';
