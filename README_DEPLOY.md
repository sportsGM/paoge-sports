# v42 clean release 部署說明

這包已經清掉舊版 SQL 與舊 README，避免誤跑舊 SQL 造成資料被覆蓋。

## 正式上線需要上傳的檔案

- index.html
- config.js
- assets/woodfish.png
- assets/road.png
- assets/grandma.png

## Supabase 只需要跑這個

請到 Supabase SQL Editor 執行：

- SQL_RUN_THIS_ONLY_v42.sql

這個檔案會：

1. 建立 / 補齊目前網站需要的資料表與欄位
2. 補齊 app_users / comments / predictions / interaction_counts / online_base_settings
3. 開放目前前端需要的 anon 讀寫權限
4. 清除 app_users 帳號密碼前後空格
5. 重設兩個管理員帳號

## 預設管理員帳號

- paoge5888 / 123456
- yao88 / 123456

如果要改密碼，請先在 SQL_RUN_THIS_ONLY_v42.sql 裡搜尋 123456，改成你要的密碼再執行。

## 重要提醒

這版是前端直接連 Supabase REST API 的簡易營運版，所以 SQL 會 disable RLS 並開放 anon 權限。
正式大流量營運或涉及真實個資/金流時，建議改成 Supabase Auth + RLS 或後端 API。
