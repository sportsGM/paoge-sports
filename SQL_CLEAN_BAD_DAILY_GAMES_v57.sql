-- v57 清理前幾版誤抓的賽事資料：會關閉今天 active 的錯誤列，重新跑 workflow 後會寫入新版格式。
update public.daily_games
set active = false, updated_at = now()
where active = true
  and (
    away ~ '^[0-9]' or home ~ '^[0-9]' or
    away like '%戰資訊%' or home like '%戰資訊%' or
    spread ~ '\m1\.[0-9]' or total ~ '\m1\.[0-9]'
  );
