-- v55 選用：每日同步狀態表
-- 建議跑一次，方便看每次 GitHub Actions 是否抓到賽事。

create table if not exists public.daily_sync_status (
  id uuid primary key default gen_random_uuid(),
  sync_date date not null default current_date,
  source_name text not null default 'playsport',
  status text not null default 'unknown',
  message text,
  games_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(sync_date, source_name)
);

grant select, insert, update, delete on public.daily_sync_status to anon, authenticated;
alter table public.daily_sync_status disable row level security;
