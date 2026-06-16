-- Job Search OS — Supabase schema (canonical). Paste once into Supabase > SQL Editor > New query > Run.
-- Per-user data is owned by an auth user and locked to them by Row-Level Security (RLS): a signed-in user
-- can read/write ONLY their own rows. The seed script (pipeline/push-to-supabase.mjs) uses the service-role
-- key, which bypasses RLS, to plant your data the first time.

create table if not exists profiles (
  owner       uuid primary key references auth.users on delete cascade,
  email       text,
  name        text,
  is_owner    boolean default false,
  secular     boolean default true,
  consent_at  timestamptz,
  pack        jsonb,                 -- the per-user pack: { ROLES, JDS, CONTACTS, RECRUITERS, CV_TEXT, JS_PROFILE, ... }
  updated_at  timestamptz default now()
);

create table if not exists app_state (
  owner       uuid not null references auth.users on delete cascade,
  key         text not null,         -- jsos_pipeline | jsos_outcomes | jsos_log | jsos_jd | jsos_status | ...
  value       jsonb,
  updated_at  timestamptz default now(),
  primary key (owner, key)
);

create table if not exists review_cache (   -- server-side cache of free-model outputs (never hammer a free tier twice)
  cache_key   text primary key,
  model       text,
  result      jsonb,
  created_at  timestamptz default now()
);

alter table profiles     enable row level security;
alter table app_state    enable row level security;
alter table review_cache enable row level security;   -- intentionally NO policy: the browser can't touch it; only the service role (in /api) can

drop policy if exists own_profile on profiles;
create policy own_profile on profiles
  for all using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists own_state on app_state;
create policy own_state on app_state
  for all using (owner = auth.uid()) with check (owner = auth.uid());
