-- One invisible Budapest demand-event calendar for every Budapest hotel.
--
-- Existing screens intentionally keep reading demand_events by organization.
-- This migration keeps that contract, but mirrors the same canonical Budapest
-- event into every organization that has a Budapest revenue-market setting.
-- That means the Events calendar and the revenue price-list calendar receive
-- identical event data without exposing a new "shared" concept in the UI.
--
-- Bootstrap rule: when the same event already exists in several organizations,
-- Ottofiori's copy wins, because it is the most complete/maintained calendar.
-- After bootstrap, inserts/edits/deletes from any Budapest hotel are mirrored
-- to the other Budapest organizations automatically.

create or replace function public.hotelcare_is_budapest_market(p_city text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(lower(trim(p_city)), ''), 'budapest') = 'budapest';
$$;

-- Build one canonical snapshot from today's data. Exact event identity follows
-- the existing demand_events unique index: date + case-insensitive title.
create temporary table _hotelcare_budapest_event_seed on commit drop as
select distinct on (d.event_date, lower(d.title))
  d.country,
  d.city,
  d.title,
  d.category,
  d.venue,
  d.event_date,
  d.end_date,
  d.expected_impact,
  d.recurs_annually,
  d.notes,
  d.url,
  d.source,
  d.confidence,
  d.approved,
  d.surcharge_eur,
  d.updated_at
from public.demand_events d
where public.hotelcare_is_budapest_market(d.city)
order by
  d.event_date,
  lower(d.title),
  (lower(coalesce(d.hotel_id, '')) = 'ottofiori') desc,
  d.approved desc,
  d.updated_at desc,
  d.created_at desc;

-- One local storage row per organization is enough because both event screens
-- are organization-scoped today. Prefer Ottofiori as the RD Hotels storage row.
create temporary table _hotelcare_budapest_orgs on commit drop as
select
  s.organization_slug,
  coalesce(
    max(s.hotel_id) filter (where lower(coalesce(s.hotel_id, '')) = 'ottofiori'),
    min(s.hotel_id)
  ) as hotel_id
from public.hotel_revenue_settings s
where public.hotelcare_is_budapest_market(s.market_city)
group by s.organization_slug;

-- First make all already-existing exact matches identical to the preferred
-- canonical version (Ottofiori wins where it has that event).
update public.demand_events d
set
  hotel_id = o.hotel_id,
  country = coalesce(nullif(c.country, ''), 'Hungary'),
  city = 'Budapest',
  title = c.title,
  category = c.category,
  venue = c.venue,
  end_date = c.end_date,
  expected_impact = c.expected_impact,
  recurs_annually = c.recurs_annually,
  notes = c.notes,
  url = c.url,
  source = c.source,
  confidence = c.confidence,
  approved = c.approved,
  surcharge_eur = c.surcharge_eur,
  updated_at = greatest(d.updated_at, c.updated_at)
from _hotelcare_budapest_event_seed c, _hotelcare_budapest_orgs o
where d.organization_slug = o.organization_slug
  and public.hotelcare_is_budapest_market(d.city)
  and d.event_date = c.event_date
  and lower(d.title) = lower(c.title);

-- Fill every missing canonical event into RD Hotels, SLNT and any other
-- organization that currently has a Budapest hotel.
insert into public.demand_events (
  organization_slug,
  hotel_id,
  country,
  city,
  title,
  category,
  venue,
  event_date,
  end_date,
  expected_impact,
  recurs_annually,
  notes,
  url,
  source,
  confidence,
  approved,
  surcharge_eur,
  created_by,
  created_at,
  updated_at
)
select
  o.organization_slug,
  o.hotel_id,
  coalesce(nullif(c.country, ''), 'Hungary'),
  'Budapest',
  c.title,
  c.category,
  c.venue,
  c.event_date,
  c.end_date,
  c.expected_impact,
  c.recurs_annually,
  c.notes,
  c.url,
  c.source,
  c.confidence,
  c.approved,
  c.surcharge_eur,
  null,
  now(),
  now()
from _hotelcare_budapest_orgs o
cross join _hotelcare_budapest_event_seed c
where not exists (
  select 1
  from public.demand_events d
  where d.organization_slug = o.organization_slug
    and public.hotelcare_is_budapest_market(d.city)
    and d.event_date = c.event_date
    and lower(d.title) = lower(c.title)
);

-- Keep one Budapest event in lockstep across every Budapest organization.
-- pg_trigger_depth prevents the mirrored writes from recursively mirroring.
create or replace function public.sync_shared_budapest_demand_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public.hotelcare_is_budapest_market(old.city)
       and exists (
         select 1
         from public.hotel_revenue_settings s
         where s.organization_slug = old.organization_slug
           and public.hotelcare_is_budapest_market(s.market_city)
       ) then
      delete from public.demand_events d
      where d.id <> old.id
        and public.hotelcare_is_budapest_market(d.city)
        and d.event_date = old.event_date
        and lower(d.title) = lower(old.title);
    end if;
    return old;
  end if;

  -- If an edit changes the shared identity (date/title) or moves the event out
  -- of Budapest, remove the old mirrored copies first.
  if tg_op = 'UPDATE'
     and public.hotelcare_is_budapest_market(old.city)
     and (
       not public.hotelcare_is_budapest_market(new.city)
       or old.event_date is distinct from new.event_date
       or lower(old.title) is distinct from lower(new.title)
     ) then
    delete from public.demand_events d
    where d.id <> new.id
      and public.hotelcare_is_budapest_market(d.city)
      and d.event_date = old.event_date
      and lower(d.title) = lower(old.title);
  end if;

  if not public.hotelcare_is_budapest_market(new.city) then
    return new;
  end if;

  -- Only a hotel belonging to a Budapest market may publish into the shared
  -- Budapest pool. This keeps an unrelated organization from doing so merely
  -- by writing city='Budapest' on a row.
  if not exists (
    select 1
    from public.hotel_revenue_settings s
    where s.organization_slug = new.organization_slug
      and public.hotelcare_is_budapest_market(s.market_city)
  ) then
    return new;
  end if;

  for v_target in
    select
      s.organization_slug,
      coalesce(
        max(s.hotel_id) filter (where lower(coalesce(s.hotel_id, '')) = 'ottofiori'),
        min(s.hotel_id)
      ) as hotel_id
    from public.hotel_revenue_settings s
    where public.hotelcare_is_budapest_market(s.market_city)
    group by s.organization_slug
  loop
    -- The source row already contains the edit/insert. Only mirror to the
    -- other organizations; RLS keeps each organization seeing its local copy.
    if v_target.organization_slug = new.organization_slug then
      continue;
    end if;

    update public.demand_events d
    set
      hotel_id = v_target.hotel_id,
      country = coalesce(nullif(new.country, ''), 'Hungary'),
      city = 'Budapest',
      title = new.title,
      category = new.category,
      venue = new.venue,
      end_date = new.end_date,
      expected_impact = new.expected_impact,
      recurs_annually = new.recurs_annually,
      notes = new.notes,
      url = new.url,
      source = new.source,
      confidence = new.confidence,
      approved = new.approved,
      surcharge_eur = new.surcharge_eur,
      updated_at = now()
    where d.organization_slug = v_target.organization_slug
      and public.hotelcare_is_budapest_market(d.city)
      and d.event_date = new.event_date
      and lower(d.title) = lower(new.title);

    if not found then
      insert into public.demand_events (
        organization_slug,
        hotel_id,
        country,
        city,
        title,
        category,
        venue,
        event_date,
        end_date,
        expected_impact,
        recurs_annually,
        notes,
        url,
        source,
        confidence,
        approved,
        surcharge_eur,
        created_by,
        created_at,
        updated_at
      ) values (
        v_target.organization_slug,
        v_target.hotel_id,
        coalesce(nullif(new.country, ''), 'Hungary'),
        'Budapest',
        new.title,
        new.category,
        new.venue,
        new.event_date,
        new.end_date,
        new.expected_impact,
        new.recurs_annually,
        new.notes,
        new.url,
        new.source,
        new.confidence,
        new.approved,
        new.surcharge_eur,
        null,
        now(),
        now()
      );
    end if;
  end loop;

  return new;
end;
$$;

-- When a new organization/hotel is onboarded in Budapest, populate it from
-- the current shared pool automatically. Moving the organization's final
-- Budapest hotel to another market removes only its local Budapest copies.
create or replace function public.seed_shared_budapest_events_for_hotel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.demand_events%rowtype;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if not public.hotelcare_is_budapest_market(new.market_city) then
    if tg_op = 'UPDATE'
       and public.hotelcare_is_budapest_market(old.market_city)
       and not exists (
         select 1
         from public.hotel_revenue_settings s
         where s.organization_slug = new.organization_slug
           and s.hotel_id <> new.hotel_id
           and public.hotelcare_is_budapest_market(s.market_city)
       ) then
      -- This delete is nested under the settings trigger, so the demand-event
      -- mirroring trigger deliberately ignores it and leaves the global pool.
      delete from public.demand_events d
      where d.organization_slug = new.organization_slug
        and public.hotelcare_is_budapest_market(d.city);
    end if;
    return new;
  end if;

  for v_event in
    select distinct on (d.event_date, lower(d.title)) d.*
    from public.demand_events d
    where public.hotelcare_is_budapest_market(d.city)
      and d.organization_slug <> new.organization_slug
    order by
      d.event_date,
      lower(d.title),
      (lower(coalesce(d.hotel_id, '')) = 'ottofiori') desc,
      d.updated_at desc,
      d.created_at desc
  loop
    update public.demand_events d
    set
      country = coalesce(nullif(v_event.country, ''), 'Hungary'),
      city = 'Budapest',
      title = v_event.title,
      category = v_event.category,
      venue = v_event.venue,
      end_date = v_event.end_date,
      expected_impact = v_event.expected_impact,
      recurs_annually = v_event.recurs_annually,
      notes = v_event.notes,
      url = v_event.url,
      source = v_event.source,
      confidence = v_event.confidence,
      approved = v_event.approved,
      surcharge_eur = v_event.surcharge_eur,
      updated_at = now()
    where d.organization_slug = new.organization_slug
      and public.hotelcare_is_budapest_market(d.city)
      and d.event_date = v_event.event_date
      and lower(d.title) = lower(v_event.title);

    if not found then
      insert into public.demand_events (
        organization_slug,
        hotel_id,
        country,
        city,
        title,
        category,
        venue,
        event_date,
        end_date,
        expected_impact,
        recurs_annually,
        notes,
        url,
        source,
        confidence,
        approved,
        surcharge_eur,
        created_by,
        created_at,
        updated_at
      ) values (
        new.organization_slug,
        new.hotel_id,
        coalesce(nullif(v_event.country, ''), 'Hungary'),
        'Budapest',
        v_event.title,
        v_event.category,
        v_event.venue,
        v_event.event_date,
        v_event.end_date,
        v_event.expected_impact,
        v_event.recurs_annually,
        v_event.notes,
        v_event.url,
        v_event.source,
        v_event.confidence,
        v_event.approved,
        v_event.surcharge_eur,
        null,
        now(),
        now()
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_sync_shared_budapest_demand_event on public.demand_events;
create trigger trg_sync_shared_budapest_demand_event
after insert or update or delete on public.demand_events
for each row execute function public.sync_shared_budapest_demand_event();

drop trigger if exists trg_seed_shared_budapest_events_on_insert on public.hotel_revenue_settings;
create trigger trg_seed_shared_budapest_events_on_insert
after insert on public.hotel_revenue_settings
for each row execute function public.seed_shared_budapest_events_for_hotel();

drop trigger if exists trg_seed_shared_budapest_events_on_market_change on public.hotel_revenue_settings;
create trigger trg_seed_shared_budapest_events_on_market_change
after update of market_city, market_country, organization_slug on public.hotel_revenue_settings
for each row execute function public.seed_shared_budapest_events_for_hotel();

-- Trigger functions are implementation details, not user-callable RPCs.
revoke all on function public.sync_shared_budapest_demand_event() from public;
revoke all on function public.seed_shared_budapest_events_for_hotel() from public;
