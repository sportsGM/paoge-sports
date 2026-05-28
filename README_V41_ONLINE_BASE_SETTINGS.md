# v41 後台可調整在線人數

這版把右上角在線人數的固定基數改成由 Supabase 控制。

## 資料表

`online_base_settings`

## 欄位

- `role`：會員等級
- `morning_base`：早上 07:00-12:00 固定基數
- `day_base`：中午 12:00-晚上 24:00 固定基數
- `night_base`：晚上 00:00-早上 07:00 固定基數
- `active`：是否啟用

## 顯示公式

網站顯示人數 = 對應時段固定基數 + app_users 裡 is_online=true 的真實在線人數

## 修改方式

Supabase → Table Editor → online_base_settings

直接改 morning_base / day_base / night_base 即可。

網站每 10 分鐘會重新讀一次設定。
如果剛改完想馬上看到，按 Ctrl + F5。
