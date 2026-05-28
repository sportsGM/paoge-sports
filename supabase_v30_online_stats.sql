-- v30 在線人數區間設定
-- 這張表控制右上角假人氣數字。
-- 網站每 10 分鐘會自動在 min_count ~ max_count 之間換一個 current_count。

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

insert into public.online_stats (role, min_count, max_count, current_count, active, last_generated_at)
values
  ('體育萌新', 100, 180, 138, true, now()),
  ('一般會員', 200, 280, 226, true, now()),
  ('VIP會員', 300, 380, 318, true, now()),
  ('體育大神', 20, 45, 26, true, now())
on conflict (role) do update set
  min_count = excluded.min_count,
  max_count = excluded.max_count,
  current_count = excluded.current_count,
  active = excluded.active,
  updated_at = now();

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.online_stats to anon, authenticated;
alter table public.online_stats disable row level security;

-- 之後你可以直接在 Table Editor 修改：
-- min_count / max_count：數字區間
-- current_count：目前顯示數字
-- last_generated_at：網站每 10 分鐘會自動更新
