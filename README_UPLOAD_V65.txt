v65 今日/明日賽事正式版

更新內容：
- 前台改成「今日賽事 / 明日賽事」，移除昨日賽事。
- GitHub Actions 直接抓：
  - gameday=today
  - gameday=tomorrow
- 進入玩運彩後會先點「所有賽事」再抓。
- 今日賽事會排除已完賽/綠字完賽列。
- Supabase 新增：game_day_type = today/tomorrow、game_status = upcoming/finished。
- 前台只顯示 active=true + game_status=upcoming。
- 足球維持短版主隊/客隊、無核心球員，只做雙方近況與近期對戰分析。

使用方式：
1. 全部覆蓋 GitHub repo 最外層。
2. Supabase SQL Editor 跑 SQL_RUN_THIS_ONLY_v65_TODAY_TOMORROW.sql。
3. GitHub Actions 跑 Hourly sports sync v65。
4. 前台 Ctrl+F5。
