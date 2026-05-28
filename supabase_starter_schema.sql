-- Supabase starter schema for shared sports site
-- 建議先在 SQL Editor 執行，正式版再依權限細修 RLS policies.

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  account text unique not null,
  nickname text not null,
  line_id text,
  role text not null default '體育萌新',
  created_at timestamptz default now()
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  sport text not null,
  league text not null,
  start_time timestamptz,
  away_team text not null,
  home_team text not null,
  moneyline text,
  spread text,
  total text,
  status text not null default 'scheduled',
  raw_source jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  nickname text not null,
  board_type text not null default 'player',
  content text not null check (char_length(content) >= 5),
  created_at timestamptz default now()
);

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid references games(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  market text not null check (market in ('moneyline','spread','total')),
  pick text not null,
  line text,
  result text not null default 'pending',
  created_at timestamptz default now(),
  unique(game_id, profile_id, market)
);

create table if not exists interaction_counts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  type text not null check (type in ('woodfish','grandma')),
  count integer not null default 0,
  updated_at timestamptz default now(),
  unique(profile_id, type)
);
