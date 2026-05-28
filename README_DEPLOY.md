# 砲哥 / 龍女雙網站部署包 v19

## 已放入
- `config.js`：前端可公開設定，包含 Supabase Project URL、Publishable key、A/B 網站投注連結。
- `.env.example`：後端環境變數範例。請勿把真正的 `SUPABASE_SERVICE_ROLE_KEY` 放進 GitHub 或前端。

## 重要
你剛剛提供的 Secret key / service_role key 只能放在後端環境變數，不能放進 `index.html`、`config.js` 或 GitHub Pages。

## A/B 網站
- A：`paoge.sports.com`，我要投注 → `https://money888.mw168.online`
- B：`yao88.sports.com`，我要投注 → `https://money777.mw168.online`

## Supabase
- Project URL: `https://azubzmuavfstxwzmrjvn.supabase.co`
- Publishable key 已放入 `config.js`
- Secret key 請放到後端平台的環境變數，例如 Vercel / Render / Railway / Supabase Edge Functions Secrets


## v38 管理員開通方式

玩家註冊後，資料會進入 Supabase 的 `app_users` 表。

管理員不用每次跑 SQL，直接到：

Supabase → Table Editor → app_users → 找到玩家帳號 → 修改 `role`

角色可填：

- 體育萌新
- 一般會員
- VIP會員
- 體育大神

詳細說明請看：

`README_ADMIN_ROLE_EDIT_V38.md`
