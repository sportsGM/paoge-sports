-- v63 optional check: 查看 MLB 今日資料是否被寫入
select game_date, sport, league, active, count(*) as games_count, max(updated_at) as last_update
from public.daily_games
group by game_date, sport, league, active
order by game_date desc, sport, league;
