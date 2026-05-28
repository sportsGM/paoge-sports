-- 可選：後台常用查詢，不需要每次跑。

-- 查看會員
select account, nickname, line_id, role, month_recommended, month_wins, is_online, created_at
from public.app_users
order by created_at desc;

-- 手動改權限，把 USER_ACCOUNT 改成玩家帳號
-- update public.app_users set role = '一般會員' where account = 'USER_ACCOUNT';
-- update public.app_users set role = 'VIP會員' where account = 'USER_ACCOUNT';
-- update public.app_users set role = '體育大神' where account = 'USER_ACCOUNT';
-- update public.app_users set role = '體育萌新' where account = 'USER_ACCOUNT';

-- 查看在線人數基數
select role, morning_base, day_base, night_base, active
from public.online_base_settings
order by case role when '體育萌新' then 1 when '一般會員' then 2 when 'VIP會員' then 3 when '體育大神' then 4 else 99 end;

-- 檢查是否有重複帳號
select trim(account) as account, count(*) as duplicate_count
from public.app_users
where account is not null
group by trim(account)
having count(*) > 1;
