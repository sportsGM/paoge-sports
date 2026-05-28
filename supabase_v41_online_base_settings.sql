-- v41 後台可調整在線人數
-- 網站右上角在線人數 = 這張表的固定基數 + app_users 裡目前 is_online=true 的真實人數。
-- 你之後只要到 Table Editor → online_base_settings 修改數字即可，不用改網站程式。

create table if not exists public.online_base_settings (
  id uuid primary key default gen_random_uuid(),
  role text unique not null,
  morning_base integer not null default 0, -- 07:00-12:00
  day_base integer not null default 0,     -- 12:00-24:00
  night_base integer not null default 0,   -- 00:00-07:00
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

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.online_base_settings to anon, authenticated;
alter table public.online_base_settings disable row level security;

-- 查看目前設定
select role, morning_base, day_base, night_base, active
from public.online_base_settings
order by
  case role
    when '體育萌新' then 1
    when '一般會員' then 2
    when 'VIP會員' then 3
    when '體育大神' then 4
    else 99
  end;
