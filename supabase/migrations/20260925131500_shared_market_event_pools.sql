-- Generalize demand events from a Budapest-only mirror into a market pool.
--
-- Every active hotel belongs to a market (city + country). Demand events are
-- still stored as organisation-local rows so existing RLS and UI contracts
-- remain intact, but writes are mirrored only to organisations that have a
-- hotel in the same market. Future hotels are seeded from that market's pool
-- when their location is configured.

alter table public.hotel_configurations
  add column if not exists market_city text,
  add column if not exists market_country text;

comment on column public.hotel_configurations.market_city is
  'Canonical hotel market city used for shared demand-event pools.';
comment on column public.hotel_configurations.market_country is
  'Canonical hotel market country used for shared demand-event pools.';

-- All properties that existed before market-aware onboarding are in Budapest.
update public.hotel_configurations
set
  market_city = case
    when nullif(trim(market_city), '') is null then 'Budapest'
    else trim(market_city)
  end,
  market_country = case
    when nullif(trim(market_country), '') is null then 'Hungary'
    else trim(market_country)
  end
where nullif(trim(market_city), '') is null
   or nullif(trim(market_country), '') is null;

-- Keep the legacy revenue settings in sync for existing code that still reads
-- these fields. hotel_configurations is the canonical source going forward.
update public.hotel_revenue_settings s
set
  market_city = h.market_city,
  market_country = h.market_country,
  updated_at = now()
from public.hotel_configurations h
where h.hotel_id = s.hotel_id
  and (
    s.market_city is distinct from h.market_city
    or s.market_country is distinct from h.market_country
  );

-- Remove the Budapest-only trigger wiring before installing the generic pool.
drop trigger if exists trg_sync_shared_budapest_demand_event on public.demand_events;
drop trigger if exists trg_seed_shared_budapest_events_on_insert on public.hotel_revenue_settings;
drop trigger if exists trg_seed_shared_budapest_events_on_market_change on public.hotel_revenue_settings;

create or replace function public.hotelcare_market_normalize(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.hotelcare_same_market(
  p_city_a text,
  p_country_a text,
  p_city_b text,
  p_country_b text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    public.hotelcare_market_normalize(p_city_a) <> ''
    and public.hotelcare_market_normalize(p_country_a) <> ''
    and public.hotelcare_market_normalize(p_city_a) = public.hotelcare_market_normalize(p_city_b)
    and public.hotelcare_market_normalize(p_country_a) = public.hotelcare_market_normalize(p_country_b);
$$;

create or replace function public.hotelcare_org_has_market(
  p_organization_slug text,
  p_city text,
  p_country text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.hotel_configurations h
    join public.organizations o on o.id = h.organization_id
    where o.slug = p_organization_slug
      and coalesce(h.is_active, true)
      and public.hotelcare_same_market(h.market_city, h.market_country, p_city, p_country)
  );
$$;

-- Mirror one market event across every organisation that currently has at
-- least one active hotel in the same city + country. Existing RLS stays
-- organisation-local; users never gain cross-tenant table access.
create or replace function public.sync_shared_market_demand_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_old_is_market boolean := false;
  v_new_is_market boolean := false;
begin
  -- Writes performed by the mirror/seed functions must not fan out again.
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then
    v_old_is_market := public.hotelcare_org_has_market(
      old.organization_slug, old.city, old.country
    );
  end if;

  if tg_op <> 'DELETE' then
    v_new_is_market := public.hotelcare_org_has_market(
      new.organization_slug, new.city, new.country
    );
  end if;

  if tg_op = 'DELETE' then
    if v_old_is_market then
      delete from public.demand_events d
      where public.hotelcare_same_market(d.city, d.country, old.city, old.country)
        and d.event_date = old.event_date
        and lower(d.title) = lower(old.title);
    end if;
    return old;
  end if;

  -- If an edit changes market identity, event date or title, remove the old
  -- mirrored identity first. The current source row is excluded on updates.
  if tg_op = 'UPDATE'
     and v_old_is_market
     and (
       not public.hotelcare_same_market(old.city, old.country, new.city, new.country)
       or old.event_date is distinct from new.event_date
       or lower(old.title) is distinct from lower(new.title)
     ) then
    delete from public.demand_events d
    where d.id <> new.id
      and public.hotelcare_same_market(d.city, d.country, old.city, old.country)
      and d.event_date = old.event_date
      and lower(d.title) = lower(old.title);
  end if;

  -- Do not publish an event into a market unless the source organisation
  -- actually has an active hotel there.
  if not v_new_is_market then
    return new;
  end if;

  for v_target in
    select
      o.slug as organization_slug,
      min(h.hotel_id) as hotel_id
    from public.hotel_configurations h
    join public.organizations o on o.id = h.organization_id
    where coalesce(h.is_active, true)
      and public.hotelcare_same_market(
        h.market_city, h.market_country, new.city, new.country
      )
    group by o.slug
  loop
    if v_target.organization_slug = new.organization_slug then
      continue;
    end if;

    update public.demand_events d
    set
      hotel_id = coalesce(d.hotel_id, v_target.hotel_id),
      country = new.country,
      city = new.city,
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
      and public.hotelcare_same_market(d.city, d.country, new.city, new.country)
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
        new.country,
        new.city,
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

-- A newly onboarded hotel receives the existing pool for its configured
-- market. If the last hotel of an organisation leaves a market, only that
-- organisation's local mirror is removed; the shared pool remains for others.
create or replace function public.seed_shared_market_events_for_hotel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_org text;
  v_old_org text;
  v_event public.demand_events%rowtype;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  select o.slug into v_new_org
  from public.organizations o
  where o.id = new.organization_id;

  if tg_op = 'UPDATE' then
    select o.slug into v_old_org
    from public.organizations o
    where o.id = old.organization_id;

    if v_old_org is not null
       and public.hotelcare_market_normalize(old.market_city) <> ''
       and public.hotelcare_market_normalize(old.market_country) <> ''
       and (
         v_old_org is distinct from v_new_org
         or not public.hotelcare_same_market(
           old.market_city, old.market_country,
           new.market_city, new.market_country
         )
         or (coalesce(old.is_active, true) and not coalesce(new.is_active, true))
       )
       and not exists (
         select 1
         from public.hotel_configurations h
         join public.organizations o on o.id = h.organization_id
         where h.id <> new.id
           and o.slug = v_old_org
           and coalesce(h.is_active, true)
           and public.hotelcare_same_market(
             h.market_city, h.market_country,
             old.market_city, old.market_country
           )
       ) then
      delete from public.demand_events d
      where d.organization_slug = v_old_org
        and public.hotelcare_same_market(
          d.city, d.country, old.market_city, old.market_country
        );
    end if;
  end if;

  -- Maintain legacy revenue settings when such a row already exists.
  update public.hotel_revenue_settings s
  set
    market_city = new.market_city,
    market_country = new.market_country,
    updated_at = now()
  where s.hotel_id = new.hotel_id
    and (
      s.market_city is distinct from new.market_city
      or s.market_country is distinct from new.market_country
    );

  if not coalesce(new.is_active, true)
     or v_new_org is null
     or public.hotelcare_market_normalize(new.market_city) = ''
     or public.hotelcare_market_normalize(new.market_country) = '' then
    return new;
  end if;

  for v_event in
    select distinct on (d.event_date, lower(d.title)) d.*
    from public.demand_events d
    where public.hotelcare_same_market(
      d.city, d.country, new.market_city, new.market_country
    )
    order by
      d.event_date,
      lower(d.title),
      d.approved desc,
      d.updated_at desc,
      d.created_at desc
  loop
    update public.demand_events d
    set
      country = new.market_country,
      city = new.market_city,
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
    where d.organization_slug = v_new_org
      and public.hotelcare_same_market(
        d.city, d.country, new.market_city, new.market_country
      )
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
        v_new_org,
        new.hotel_id,
        new.market_country,
        new.market_city,
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

drop trigger if exists trg_sync_shared_market_demand_event on public.demand_events;
create trigger trg_sync_shared_market_demand_event
after insert or update or delete on public.demand_events
for each row execute function public.sync_shared_market_demand_event();

drop trigger if exists trg_seed_shared_market_events_on_hotel_insert on public.hotel_configurations;
create trigger trg_seed_shared_market_events_on_hotel_insert
after insert on public.hotel_configurations
for each row execute function public.seed_shared_market_events_for_hotel();

drop trigger if exists trg_seed_shared_market_events_on_hotel_change on public.hotel_configurations;
create trigger trg_seed_shared_market_events_on_hotel_change
after update of market_city, market_country, organization_id, hotel_id, is_active
on public.hotel_configurations
for each row execute function public.seed_shared_market_events_for_hotel();

revoke all on function public.sync_shared_market_demand_event() from public, anon, authenticated;
revoke all on function public.seed_shared_market_events_for_hotel() from public, anon, authenticated;
revoke all on function public.hotelcare_org_has_market(text, text, text) from public, anon, authenticated;
