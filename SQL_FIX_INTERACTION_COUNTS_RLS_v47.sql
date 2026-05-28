-- v47 木魚 / 阿嬤互動次數 RLS 修正
-- 用途：修正 new row violates row-level security policy for table "interaction_counts"
-- 請到 Supabase > SQL Editor 執行整段。

create table if not exists public.interaction_counts (
  id uuid primary key default gen_random_uuid(),
  account text,
  nickname text,
  type text not null default 'woodfish',
  interaction_type text,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.interaction_counts add column if not exists account text;
alter table public.interaction_counts add column if not exists nickname text;
alter table public.interaction_counts add column if not exists type text not null default 'woodfish';
alter table public.interaction_counts add column if not exists interaction_type text;
alter table public.interaction_counts add column if not exists count integer not null default 0;
alter table public.interaction_counts add column if not exists updated_at timestamptz not null default now();

create index if not exists interaction_counts_type_idx
on public.interaction_counts (type, account, updated_at desc);

-- 給前端 anon key 讀寫互動排行
grant select, insert, update, delete on public.interaction_counts to anon, authenticated;

-- 這個網站目前是純前端 GitHub Pages 版，先關掉 interaction_counts 的 RLS，避免木魚 / 阿嬤寫入被擋。
alter table public.interaction_counts disable row level security;

-- 檢查用
select
  relname as table_name,
  relrowsecurity as rls_enabled
from pg_class
where relname = 'interaction_counts';
