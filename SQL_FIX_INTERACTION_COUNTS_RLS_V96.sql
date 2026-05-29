-- v96：修正木魚 / 阿嬤互動次數無法回傳後端
create extension if not exists pgcrypto;

create table if not exists public.interaction_counts (
  id uuid primary key default gen_random_uuid(),
  account text not null,
  nickname text,
  type text,
  interaction_type text,
  count integer not null default 0,
  updated_at timestamptz default now()
);

alter table public.interaction_counts add column if not exists id uuid default gen_random_uuid();
alter table public.interaction_counts add column if not exists account text;
alter table public.interaction_counts add column if not exists nickname text;
alter table public.interaction_counts add column if not exists type text;
alter table public.interaction_counts add column if not exists interaction_type text;
alter table public.interaction_counts add column if not exists count integer default 0;
alter table public.interaction_counts add column if not exists updated_at timestamptz default now();

update public.interaction_counts
set type = coalesce(type, interaction_type),
    interaction_type = coalesce(interaction_type, type),
    count = coalesce(count, 0),
    updated_at = coalesce(updated_at, now());

alter table public.interaction_counts enable row level security;

drop policy if exists "interaction_counts_select_public" on public.interaction_counts;
drop policy if exists "interaction_counts_insert_public" on public.interaction_counts;
drop policy if exists "interaction_counts_update_public" on public.interaction_counts;

create policy "interaction_counts_select_public"
on public.interaction_counts
for select
to anon, authenticated
using (true);

create policy "interaction_counts_insert_public"
on public.interaction_counts
for insert
to anon, authenticated
with check (true);

create policy "interaction_counts_update_public"
on public.interaction_counts
for update
to anon, authenticated
using (true)
with check (true);
