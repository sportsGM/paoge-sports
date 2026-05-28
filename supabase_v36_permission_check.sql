-- v36 會員權限檢查與體育大神候選名單

-- 1. 查看所有會員目前權限
select
  account,
  nickname,
  role,
  month_recommended,
  month_wins,
  case
    when month_recommended > 0 then round((month_wins::numeric / month_recommended::numeric) * 100, 1)
    else 0
  end as accuracy_percent
from public.app_users
order by role, nickname;

-- 2. 查看符合體育大神門檻的 VIP 玩家
-- 條件：VIP會員、本月至少預測30場、準確率70%以上
select
  account,
  nickname,
  role,
  month_recommended,
  month_wins,
  round((month_wins::numeric / month_recommended::numeric) * 100, 1) as accuracy_percent
from public.app_users
where role = 'VIP會員'
  and month_recommended >= 30
  and (month_wins::numeric / nullif(month_recommended, 0)) >= 0.70
order by accuracy_percent desc, month_wins desc;

-- 3. 手動把符合資格的 VIP 升級成體育大神
-- 注意：正式使用前，請先確認上面第2段查詢結果
-- update public.app_users
-- set role = '體育大神'
-- where role = 'VIP會員'
--   and month_recommended >= 30
--   and (month_wins::numeric / nullif(month_recommended, 0)) >= 0.70;

-- 4. 次月重置時，可把不符合門檻的體育大神調回 VIP會員
-- update public.app_users
-- set role = 'VIP會員'
-- where role = '體育大神'
--   and (
--     month_recommended < 30
--     or (month_wins::numeric / nullif(month_recommended, 0)) < 0.70
--   );
