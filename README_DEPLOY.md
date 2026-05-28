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
