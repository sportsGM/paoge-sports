v56 玩運彩正規表格解析版

請上傳到 GitHub Code 最外層覆蓋：
1. package.json
2. scripts/daily_sports_sync.js
3. .github/workflows/daily_sports_sync.yml（如果 .github 上傳失敗，就直接編輯原本 yml，不用新增）

完整網站前台請另外覆蓋 v56 完整包的：
index.html
config.js
assets/

更新後到 Actions → daily_sports_sync.yml → Run workflow。
成功後 log 會看到 Parsed valid games: 數字。
