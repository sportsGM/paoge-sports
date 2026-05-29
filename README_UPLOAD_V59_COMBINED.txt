v59 合併版上傳說明

把這個壓縮檔解壓縮後，將裡面的所有檔案與資料夾上傳到 GitHub repo 最外層，覆蓋原本檔案。

一定要在最外層看到：
- index.html
- config.js
- assets/
- package.json
- scripts/daily_sports_sync.js
- .github/workflows/daily_sports_sync.yml

上傳後請到 Supabase SQL Editor 跑：
- SQL_CLEAN_DEMO_GAMES_v59.sql

再到 GitHub Actions 執行：
- Hourly sports sync v59
- Run workflow
