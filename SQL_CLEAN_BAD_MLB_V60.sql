-- v60：清掉前幾版誤抓到 MLB 裡的足球/比分文字資料
-- 例如：0 vs S. 0 馬卡拉、1 vs S. 4 青年體育會。

update public.daily_games
set active = false, updated_at = now()
where league = 'MLB'
  and (
    away ~* '(^|\s)(vs|v\.s\.?)(\s|$)'
    or home ~* '(^|\s)(vs|v\.s\.?)(\s|$)'
    or away ~* 'S\.\s*[0-9]'
    or home ~* 'S\.\s*[0-9]'
    or away ~* '^[0-9]+\s*(vs|v\.s\.?)'
    or home ~* '^[0-9]+\s*(vs|v\.s\.?)'
    or away ilike '%馬卡拉%'
    or home ilike '%馬卡拉%'
    or away ilike '%水晶體育%'
    or home ilike '%水晶體育%'
    or away ilike '%青年體育%'
    or home ilike '%青年體育%'
    or away ilike '%天主教大學%'
    or home ilike '%天主教大學%'
  );

-- 檢查目前 MLB 還剩哪些 active 資料
select game_date, league, active, away, home, game_time, money, spread, total, updated_at
from public.daily_games
where league = 'MLB'
order by updated_at desc, game_time
limit 50;
