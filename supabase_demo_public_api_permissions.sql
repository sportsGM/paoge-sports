-- 如果網站讀寫 Supabase 時顯示 permission denied / 401 / 403，請在 SQL Editor 執行這段。
-- 展示版用：開放 anon 讀寫以下資料表。正式營運前建議改成 RLS + Auth 或後端 API。

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.app_users to anon, authenticated;
grant select, insert, update, delete on public.comments to anon, authenticated;
grant select, insert, update, delete on public.predictions to anon, authenticated;
grant select, insert, update, delete on public.interaction_counts to anon, authenticated;
grant select, insert, update, delete on public.games to anon, authenticated;

alter table public.app_users disable row level security;
alter table public.comments disable row level security;
alter table public.predictions disable row level security;
alter table public.interaction_counts disable row level security;
alter table public.games disable row level security;
