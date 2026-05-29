-- v56 選用：清掉上一版誤解析的錯誤賽事，並讓今天正確同步資料顯示。
-- 更新 v56 同步程式後再跑一次 Run workflow，通常不需要手動跑這段。

update public.daily_games
set active = false, updated_at = now()
where away ~ '^[0-9]+$'
   or home ~ '^[SsVv]\\.?\\s*[0-9]'
   or away like '%賽事資訊%'
   or home like '%賽事資訊%';

select game_date, active, league, count(*) as games_count, max(updated_at) as last_update
from public.daily_games
group by game_date, active, league
order by game_date desc, active desc, league;
