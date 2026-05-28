-- v32 留言與每日熱推欄位
-- 執行後，各賽事留言會依 game_key + match_date 區分。
-- 隔天網站只讀當日留言；舊留言可手動或排程清除。

alter table public.comments add column if not exists game_key text;
alter table public.comments add column if not exists account text;
alter table public.comments add column if not exists nickname text;
alter table public.comments add column if not exists market_pick text;
alter table public.comments add column if not exists comment_type text not null default 'player';
alter table public.comments add column if not exists match_date date not null default current_date;
alter table public.comments add column if not exists created_at timestamptz not null default now();

create index if not exists comments_game_date_type_idx
on public.comments (game_key, match_date, comment_type, created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.comments to anon, authenticated;
alter table public.comments disable row level security;

-- 每天清除昨日以前留言與預測：可以手動跑，也可以之後放到排程
delete from public.comments where match_date < current_date;

-- 如果 predictions 也想每日清空，可以先加欄位再清：
alter table public.predictions add column if not exists match_date date not null default current_date;
delete from public.predictions where match_date < current_date;
