-- ===========================================================================
-- Art Show Tracker — Supabase schema (Phase 3)
-- Run this once in the Supabase SQL editor for your project.
-- Safe to re-run: every statement is guarded.
-- ===========================================================================

create table if not exists public.shows (
  id            uuid primary key,
  owner_id      uuid not null references auth.users (id) on delete cascade,

  name          text not null default '',
  city          text not null default '',
  state         text not null default '',
  lat           double precision,
  lng           double precision,

  start_date    date,
  end_date      date,
  apply_by      date,

  status        text not null default 'interested'
                check (status in ('interested','applied','accepted','waitlist','declined','not_applying')),
  rating        smallint not null default 0 check (rating between 0 and 10),

  jury_fee      numeric,
  booth_fee     numeric,

  route_number  text not null default '',
  is_alternate  boolean not null default false,
  -- Phase 7: hidden is a planning lens (out of the route, still in the season);
  -- catalogue_id ties a row back to the catalogue record it was added from.
  hidden        boolean not null default false,
  catalogue_id  text not null default '',
  notes         text not null default '',
  url           text not null default '',
  source        text not null default 'manual'
                check (source in ('manual','zapp_paste','csv')),

  -- Soft delete. Sync is last-write-wins on updated_at, so a delete has to be
  -- a row that still exists — otherwise the other device just pushes it back.
  deleted_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shows_owner_idx on public.shows (owner_id);
create index if not exists shows_owner_updated_idx on public.shows (owner_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Row level security: a signed-in user sees and writes only their own rows.
-- ---------------------------------------------------------------------------
alter table public.shows enable row level security;

drop policy if exists "shows are readable by their owner" on public.shows;
create policy "shows are readable by their owner"
  on public.shows for select
  using (auth.uid() = owner_id);

drop policy if exists "shows are insertable by their owner" on public.shows;
create policy "shows are insertable by their owner"
  on public.shows for insert
  with check (auth.uid() = owner_id);

drop policy if exists "shows are updatable by their owner" on public.shows;
create policy "shows are updatable by their owner"
  on public.shows for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "shows are deletable by their owner" on public.shows;
create policy "shows are deletable by their owner"
  on public.shows for delete
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- owner_id is never sent by the client: it is stamped from the JWT, so a
-- forged owner_id in a request body cannot land someone else's row.
-- ---------------------------------------------------------------------------
create or replace function public.shows_set_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.owner_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists shows_set_owner_trg on public.shows;
create trigger shows_set_owner_trg
  before insert or update on public.shows
  for each row execute function public.shows_set_owner();

-- ---------------------------------------------------------------------------
-- Phase 7 upgrade, for a project created before these columns existed.
-- Safe to run more than once.
-- ---------------------------------------------------------------------------
alter table public.shows add column if not exists hidden       boolean not null default false;
alter table public.shows add column if not exists catalogue_id text    not null default '';
