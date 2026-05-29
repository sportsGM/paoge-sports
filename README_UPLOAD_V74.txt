v74 使用方式：
1. 把整包解壓縮後全部覆蓋到 GitHub repo 最外層。
2. Supabase SQL Editor 跑 SQL_RUN_THIS_ONLY_v74_US_SPLIT_CONFLICT_FIX.sql。
3. GitHub Actions 跑 Hourly sports sync v74。
4. 前台 Ctrl+F5。

v74 主要修正：
- MLB/NBA/WNBA 的昨日/今日資料用 game_day_type 分開，不再互相覆蓋。
- daily_games upsert key 改為 game_date + game_day_type + league + away + home + game_time。
- 查看數據抓不到時顯示「無」，不顯示「待更新」。
