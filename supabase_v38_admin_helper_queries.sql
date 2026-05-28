-- v38 管理員常用查詢與手動開通範例
-- 不需要每次都跑 SQL。
-- 玩家註冊後，直接到 Table Editor → app_users → 修改 role 即可。

-- 1. 查看所有會員
select
  account,
  nickname,
  line_id,
  role,
  month_recommended,
  month_wins,
  case
    when month_recommended > 0 then round((month_wins::numeric / month_recommended::numeric) * 100, 1)
    else 0
  end as accuracy_percent,
  is_online,
  created_at
from public.app_users
order by created_at desc;

-- 2. 查詢單一會員
-- 把 USER_ACCOUNT 改成玩家帳號
-- select * from public.app_users where account = 'USER_ACCOUNT';

-- 3. 以下是「如果你不想用 Table Editor 手動改」才需要用的 SQL 範例
-- 一般開通：
-- update public.app_users set role = '一般會員' where account = 'USER_ACCOUNT';

-- 升級 VIP：
-- update public.app_users set role = 'VIP會員' where account = 'USER_ACCOUNT';

-- 手動給體育大神：
-- update public.app_users set role = '體育大神' where account = 'USER_ACCOUNT';

-- 降回體育萌新：
-- update public.app_users set role = '體育萌新' where account = 'USER_ACCOUNT';

-- 4. 查詢符合體育大神門檻的 VIP 玩家
select
  account,
  nickname,
  role,
  month_recommended,
  month_wins,
  round((month_wins::numeric / nullif(month_recommended, 0)) * 100, 1) as accuracy_percent
from public.app_users
where role = 'VIP會員'
  and month_recommended >= 50
  and (month_wins::numeric / nullif(month_recommended, 0)) >= 0.70
order by accuracy_percent desc, month_wins desc;
