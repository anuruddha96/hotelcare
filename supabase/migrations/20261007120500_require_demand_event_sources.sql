-- Every approved demand event must be auditable back to a real web source.
-- Repair mirrored source gaps where another copy already has a source, hide
-- the remaining unsourced legacy rows, and correct the bad 2027 Hungarian GP
-- records before enforcing the invariant.

-- 1) If one organisation's mirror has a source, use it to repair unsourced
-- copies of the same market event before hiding anything.
with canonical_source as (
  select distinct on (
    lower(trim(country)),
    lower(trim(city)),
    event_date,
    lower(title)
  )
    lower(trim(country)) as country_key,
    lower(trim(city)) as city_key,
    event_date,
    lower(title) as title_key,
    url
  from public.demand_events
  where url is not null
    and btrim(url) <> ''
    and url ~* '^https?://'
  order by
    lower(trim(country)),
    lower(trim(city)),
    event_date,
    lower(title),
    approved desc,
    confidence desc nulls last,
    updated_at desc,
    created_at desc
)
update public.demand_events d
set
  url = c.url,
  updated_at = now()
from canonical_source c
where lower(trim(d.country)) = c.country_key
  and lower(trim(d.city)) = c.city_key
  and d.event_date = c.event_date
  and lower(d.title) = c.title_key
  and (d.url is null or btrim(d.url) = '' or d.url !~* '^https?://');

-- 2) A visible/approved event without a source is not trustworthy enough to
-- influence pricing. Keep the row for audit/history, but remove it from the
-- approved calendars until a verified source is supplied.
update public.demand_events
set
  approved = false,
  updated_at = now()
where approved = true
  and (url is null or btrim(url) = '' or url !~* '^https?://');

-- 3) The shared Budapest pool currently contains several contradictory 2027
-- Hungarian Grand Prix dates, including unsourced entries. Retire all of those
-- identities, then publish one official F1 calendar entry.
update public.demand_events
set
  approved = false,
  updated_at = now()
where lower(trim(city)) = 'budapest'
  and event_date between date '2027-01-01' and date '2027-12-31'
  and (
    lower(title) like '%hungarian grand prix%'
    or lower(title) like '%magyar nagydij%'
  )
  and (
    lower(coalesce(venue, '')) like '%hungaroring%'
    or lower(title) like '%formula 1%'
    or lower(title) like '%f1%'
  );

do $$
declare
  v_org text;
  v_hotel text;
begin
  select organization_slug, hotel_id
    into v_org, v_hotel
  from public.demand_events
  where lower(trim(city)) = 'budapest'
    and event_date between date '2027-01-01' and date '2027-12-31'
    and (
      lower(title) like '%hungarian grand prix%'
      or lower(title) like '%magyar nagydij%'
    )
  order by
    (organization_slug = 'rdhotels') desc,
    updated_at desc
  limit 1;

  if v_org is not null
     and not exists (
       select 1
       from public.demand_events d
       where d.organization_slug = v_org
         and lower(trim(d.city)) = 'budapest'
         and d.event_date = date '2027-07-30'
         and lower(d.title) = lower('Formula 1 Aramco Hungarian Grand Prix 2027')
     ) then
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
      created_at,
      updated_at
    ) values (
      v_org,
      v_hotel,
      'Hungary',
      'Budapest',
      'Formula 1 Aramco Hungarian Grand Prix 2027',
      'sports',
      'Hungaroring',
      date '2027-07-30',
      date '2027-08-01',
      'high',
      false,
      'Verified against the official Formula 1 2027 Hungary race page.',
      'https://www.formula1.com/en/racing/2027/hungary',
      'verified_official',
      1,
      true,
      now(),
      now()
    );
  end if;
end
$$;

-- 4) Prevent the same defect from returning. Unapproved rows may remain as
-- audit/history, but anything used by the live event/revenue calendars must
-- carry a navigable HTTP(S) source URL.
alter table public.demand_events
  drop constraint if exists demand_events_approved_requires_source_url;

alter table public.demand_events
  add constraint demand_events_approved_requires_source_url
  check (
    approved = false
    or (
      url is not null
      and btrim(url) <> ''
      and url ~* '^https?://'
    )
  );

comment on constraint demand_events_approved_requires_source_url on public.demand_events is
  'Approved demand events must carry an external HTTP(S) source URL so pricing decisions remain auditable.';
