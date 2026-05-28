-- v33 今日 / 昨日賽事與留言保留設定
-- 網站會用 match_date 區分今天與昨天；兩天以前可以清掉。

alter table public.comments add column if not exists match_date date not null default current_date;
alter table public.predictions add column if not exists match_date date not null default current_date;

create index if not exists comments_match_date_idx
on public.comments (match_date, game_key, comment_type, created_at desc);

create index if not exists predictions_match_date_idx
on public.predictions (match_date, game_key, account, market_type);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.comments to anon, authenticated;
grant select, insert, update, delete on public.predictions to anon, authenticated;
alter table public.comments disable row level security;
alter table public.predictions disable row level security;

-- 每天可以手動跑這段，保留今天與昨天，清掉兩天以前
delete from public.comments where match_date < current_date - interval '1 day';
delete from public.predictions where match_date < current_date - interval '1 day';
