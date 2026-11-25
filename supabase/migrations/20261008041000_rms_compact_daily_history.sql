-- RMS #510 / Phase 02 — compact daily historical revenue facts.
-- This table is intentionally non-PII. Do not add guest names, emails, phones,
-- addresses, document identifiers, free-text notes, or special requests here.

create table if not exists public.revenue_historical_daily (
  hotel_id text not null,
  organization_slug text not null,
  stay_date date not null,
  observed_date date not null,
  lead_days integer generated always as (stay_date - observed_date) stored,
  rooms_sold integer not null default 0 check (rooms_sold >= 0),
  rooms_available integer not null default 0 check (rooms_available >= 0),
  occupancy_pct numeric,
  revenue_eur numeric(14,2) not null default 0 check (revenue_eur >= 0),
  adr_eur numeric(12,2),
  revpar_eur numeric(12,2),
  new_bookings integer not null default 0 check (new_bookings >= 0),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (hotel_id, stay_date, observed_date),
  check (adr_eur is null or adr_eur >= 0),
  check (revpar_eur is null or revpar_eur >= 0),
  check (occupancy_pct is null or occupancy_pct >= 0)
);

comment on table public.revenue_historical_daily is
  'Compact non-PII daily revenue history. One latest observation per hotel/stay date/business observation date.';
comment on column public.revenue_historical_daily.lead_days is
  'Booking lead time represented by stay_date minus observed_date.';

create index if not exists revenue_historical_daily_observed_idx
  on public.revenue_historical_daily (hotel_id, observed_date, stay_date);

alter table public.revenue_historical_daily enable row level security;

drop policy if exists revenue_historical_daily_select on public.revenue_historical_daily;
create policy revenue_historical_daily_select
on public.revenue_historical_daily
for select
to authenticated
using (
  auth.uid() is not null
  and public.user_can_access_hotel(auth.uid(), hotel_id)
);

grant select on public.revenue_historical_daily to authenticated, service_role;
revoke insert, update, delete on public.revenue_historical_daily from authenticated;

create or replace function public.upsert_revenue_historical_daily_from_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.revenue_historical_daily (
    hotel_id,
    organization_slug,
    stay_date,
    observed_date,
    rooms_sold,
    rooms_available,
    occupancy_pct,
    revenue_eur,
    adr_eur,
    revpar_eur,
    new_bookings,
    captured_at,
    updated_at
  )
  values (
    new.hotel_id,
    new.organization_slug,
    new.stay_date,
    new.captured_date,
    greatest(coalesce(new.rooms_sold, 0), 0),
    greatest(coalesce(new.rooms_available, 0), 0),
    case when new.occupancy_pct is null then null else greatest(new.occupancy_pct, 0) end,
    greatest(coalesce(new.revenue_eur, 0), 0),
    case when new.adr_eur is null then null else greatest(new.adr_eur, 0) end,
    case
      when coalesce(new.rooms_available, 0) > 0
        then round(greatest(coalesce(new.revenue_eur, 0), 0) / new.rooms_available, 2)
      else null
    end,
    greatest(coalesce(new.new_bookings, 0), 0),
    new.captured_at,
    now()
  )
  on conflict (hotel_id, stay_date, observed_date)
  do update set
    organization_slug = excluded.organization_slug,
    rooms_sold = excluded.rooms_sold,
    rooms_available = excluded.rooms_available,
    occupancy_pct = excluded.occupancy_pct,
    revenue_eur = excluded.revenue_eur,
    adr_eur = excluded.adr_eur,
    revpar_eur = excluded.revpar_eur,
    new_bookings = excluded.new_bookings,
    captured_at = excluded.captured_at,
    updated_at = now()
  where excluded.captured_at >= public.revenue_historical_daily.captured_at;

  return new;
end;
$$;

drop trigger if exists tr_revenue_historical_daily_snapshot on public.revenue_daily_snapshots;
create trigger tr_revenue_historical_daily_snapshot
after insert or update on public.revenue_daily_snapshots
for each row execute function public.upsert_revenue_historical_daily_from_snapshot();

-- Idempotent backfill: retain only the latest intraday state for each business
-- observation date. This intentionally does not delete or mutate the source table.
insert into public.revenue_historical_daily (
  hotel_id,
  organization_slug,
  stay_date,
  observed_date,
  rooms_sold,
  rooms_available,
  occupancy_pct,
  revenue_eur,
  adr_eur,
  revpar_eur,
  new_bookings,
  captured_at,
  updated_at
)
select
  s.hotel_id,
  s.organization_slug,
  s.stay_date,
  s.captured_date,
  greatest(coalesce(s.rooms_sold, 0), 0),
  greatest(coalesce(s.rooms_available, 0), 0),
  case when s.occupancy_pct is null then null else greatest(s.occupancy_pct, 0) end,
  greatest(coalesce(s.revenue_eur, 0), 0),
  case when s.adr_eur is null then null else greatest(s.adr_eur, 0) end,
  case
    when coalesce(s.rooms_available, 0) > 0
      then round(greatest(coalesce(s.revenue_eur, 0), 0) / s.rooms_available, 2)
    else null
  end,
  greatest(coalesce(s.new_bookings, 0), 0),
  s.captured_at,
  now()
from (
  select distinct on (hotel_id, stay_date, captured_date)
    hotel_id,
    organization_slug,
    stay_date,
    captured_date,
    rooms_sold,
    rooms_available,
    occupancy_pct,
    revenue_eur,
    adr_eur,
    new_bookings,
    captured_at
  from public.revenue_daily_snapshots
  order by hotel_id, stay_date, captured_date, captured_at desc, created_at desc
) s
on conflict (hotel_id, stay_date, observed_date)
do update set
  organization_slug = excluded.organization_slug,
  rooms_sold = excluded.rooms_sold,
  rooms_available = excluded.rooms_available,
  occupancy_pct = excluded.occupancy_pct,
  revenue_eur = excluded.revenue_eur,
  adr_eur = excluded.adr_eur,
  revpar_eur = excluded.revpar_eur,
  new_bookings = excluded.new_bookings,
  captured_at = excluded.captured_at,
  updated_at = now()
where excluded.captured_at >= public.revenue_historical_daily.captured_at;
