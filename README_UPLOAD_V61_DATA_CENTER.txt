v61 資料中心正式版使用方式

1. 解壓縮後，把所有檔案上傳覆蓋到 GitHub repo 最外層。
2. Supabase SQL Editor 跑：SQL_RUN_THIS_ONLY_v61_DATA_CENTER.sql
3. GitHub Actions → Hourly sports sync v61 → Run workflow。
4. 前台 Ctrl+F5。

v61 目標：
- 前台只讀 Supabase daily_games，不顯示資料來源字樣。
- 每個聯盟用獨立解析規則。
- 資料不完整不亂塞；隊名錯誤、0 vs S.、戰資訊等錯誤資料不寫入。
- 查看數據固定有：投手數據 / 核心球員數據 / 傷員狀況 / 雙方對比 / 歷史對戰 / 近期賽況。
- 詳細數據抓不到時顯示「待更新」，不顯示 Yahoo、SofaScore、玩運彩、台灣運彩等來源文字。
