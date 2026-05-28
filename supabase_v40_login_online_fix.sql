-- v40 登入修正與人數顯示說明
-- 這段會重設管理員帳號，並確保 app_users 權限可讀寫。
-- 網站 v40 起不再使用 online_stats 區間隨機，改用「時段基礎人數 + 真實在線人數」。

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.app_users to anon, authenticated;
alter table public.app_users disable row level security;

-- 重設管理員帳號
insert into public.app_users (
  account, password, nickname, line_id, role,
  month_recommended, month_wins, is_online
)
values
  ('paoge5888', '123456', '砲哥', '@946sjdhg', '體育大神', 30, 22, false),
  ('yao88', '123456', '龍女', '@yao88', '體育大神', 30, 21, false)
on conflict (account) do update set
  password = excluded.password,
  nickname = excluded.nickname,
  line_id = excluded.line_id,
  role = excluded.role,
  month_recommended = excluded.month_recommended,
  month_wins = excluded.month_wins,
  is_online = false;

-- 如果你想確認目前會員帳號：
select account, password, nickname, line_id, role, is_online
from public.app_users
order by created_at desc;
