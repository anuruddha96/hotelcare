create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end
$$;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function public.user_can_access_hotel(_user_id uuid, _hotel_id text)
returns boolean
language sql
stable
as $$
  select _user_id is not null
     and _hotel_id = current_setting('test.allowed_hotel', true);
$$;

create table public.revenue_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  hotel_id text not null,
  organization_slug text not null,
  stay_date date not null,
  captured_date date not null,
  rooms_sold integer,
  rooms_available integer,
  occupancy_pct numeric,
  revenue_eur numeric,
  adr_eur numeric,
  new_bookings integer,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);
