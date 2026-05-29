v55 Playwright 瀏覽器抓取版

請把這包解壓縮後，放到 GitHub repo 最外層。

一定要確認：
package.json
scripts/daily_sports_sync.js
.github/workflows/daily_sports_sync.yml

如果 .github 資料夾上傳失敗，請到 GitHub Code → Go to file → 找 daily_sports_sync.yml → Edit，
把 workflow 內容換成這包裡 .github/workflows/daily_sports_sync.yml 的內容。

GitHub Secrets 需有：
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY

SQL_SYNC_STATUS_SCHEMA_v55.sql 是選用，但建議到 Supabase SQL Editor 跑一次。
