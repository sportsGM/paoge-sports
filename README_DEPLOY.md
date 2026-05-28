# v52 部署說明

## 1. 網站檔案
把整包檔案覆蓋到 GitHub Pages 網站。

## 2. Supabase 必跑 SQL
先跑：

- `SQL_FIX_COMMENTS_INTERACTIONS_RLS_v52.sql`

這會修好：

- 好手熱推 comments 送出失敗
- 木魚 / 阿嬤 interaction_counts 不累積

## 3. 每日賽事同步 SQL
再跑：

- `SQL_DAILY_GAMES_SCHEMA_v52.sql`

這會新增 `daily_games`，讓前台可以吃每日更新賽事。

## 4. GitHub Actions 每日自動抓資料
Repository Settings → Secrets and variables → Actions → New repository secret，新增：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

之後 GitHub Actions 會每天台灣時間 06:10 / 12:10 / 18:10 跑：

- 玩運彩：抓預測賽事與盤口
- Yahoo 奇摩運動：給棒球 / NBA 隊伍數據來源
- SofaScore：給足球隊伍數據來源

目前 `scripts/daily_sports_sync.js` 已經建立同步流程與 Supabase 寫入；如果玩運彩頁面 HTML 改版，只要調整該 script 的 selector。


## v53 每小時賽事更新
GitHub Actions 已改成每小時第 7 分鐘執行一次。前台也會每小時重新讀取 daily_games。今日賽事讀取今天的 game_date，昨日賽事讀取昨天的 game_date。
