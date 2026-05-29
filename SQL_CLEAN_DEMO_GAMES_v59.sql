-- v59：清掉前端/資料庫裡曾經測試用的示範賽事，避免 MLB 點開先看到舊測試資料
-- 可放心重複執行。
update public.daily_games
set active = false, updated_at = now()
where
  (away in ('天使','太空人','落磯','馬刺','巴列卡諾閃電') and home in ('老虎','遊騎兵','道奇','雷霆','水晶宮'))
  or (home in ('天使','太空人','落磯','馬刺','巴列卡諾閃電') and away in ('老虎','遊騎兵','道奇','雷霆','水晶宮'));

select game_date, league, away, home, active, updated_at
from public.daily_games
where
  (away in ('天使','太空人','落磯','馬刺','巴列卡諾閃電') and home in ('老虎','遊騎兵','道奇','雷霆','水晶宮'))
  or (home in ('天使','太空人','落磯','馬刺','巴列卡諾閃電') and away in ('老虎','遊騎兵','道奇','雷霆','水晶宮'))
order by updated_at desc;
