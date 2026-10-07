-- Remove questionable AI-discovered events from the live pricing calendar.
-- "Remove" here means approved=false so the record remains available for audit
-- and can be restored later with a proper official reference.

create or replace function public.demand_event_reference_host(p_url text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(
    regexp_replace(
      regexp_replace(coalesce(p_url, ''), '^https?://(www\.)?', ''),
      '/.*$',
      ''
    )
  )
$$;

create or replace function public.demand_event_reference_is_low_trust(p_url text)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.demand_event_reference_host(p_url) = any(array[
    '10times.com',
    'allevents.in',
    'bachtrack.com',
    'bettitoursbudapest.com',
    'biletwise.com',
    'budapest.com',
    'budapestcalendar.com',
    'budapestopera-tickets.com',
    'budapestbesuchen.de',
    'budappest.com',
    'carnifest.com',
    'classictic.com',
    'concerts50.com',
    'de.wikipedia.org',
    'en.wikipedia.org',
    'europaticket.com',
    'eventland.eu',
    'eventworld.co',
    'eventworld.com',
    'festivalfinder.eu',
    'festscanner.com',
    'happeningnext.com',
    'myguidebudapest.com',
    'operabase.com',
    'outhere.guide',
    'port.hu',
    'programturizmus.hu',
    'ra.co',
    'songkick.com',
    'stayhappening.com',
    'ticket-budapest.com',
    'ticketle.hu',
    'timeanddate.com',
    'tripsapien.com',
    'viennaticketoffice.com',
    'wanderistan.com',
    'welovebudapest.com',
    'waset.org'
  ])
  or public.demand_event_reference_host(p_url) like '%.wikipedia.org'
  or public.demand_event_reference_host(p_url) like '%.me-ticket.com'
$$;

-- Automatic rows backed only by a generic directory, reseller, wiki or travel
-- listing are not strong enough to influence room pricing.
update public.demand_events
set
  approved = false,
  updated_at = now()
where approved = true
  and source in ('ai', 'ai_auto')
  and public.demand_event_reference_is_low_trust(url);

-- Remove obvious market-location mismatches already present in the Budapest
-- pool. These are known false positives discovered during the live audit.
update public.demand_events
set
  approved = false,
  updated_at = now()
where approved = true
  and lower(trim(city)) = 'budapest'
  and (
    lower(coalesce(venue, '')) ~ '(brugge|belgium|frankfurt|germany|vienna|austria|prague|czech|bratislava|slovakia|warsaw|poland|zagreb|croatia|bucharest|romania)'
    or lower(coalesce(country, '')) <> 'hungary'
  );

-- Database backstop: AI rows cannot be approved again with one of the known
-- weak-source hosts. Manual manager entries remain possible because the user
-- is explicitly taking responsibility for the reference they add.
alter table public.demand_events
  drop constraint if exists demand_events_ai_requires_trusted_reference;

alter table public.demand_events
  add constraint demand_events_ai_requires_trusted_reference
  check (
    approved = false
    or source not in ('ai', 'ai_auto')
    or (
      url is not null
      and not public.demand_event_reference_is_low_trust(url)
    )
  );

comment on constraint demand_events_ai_requires_trusted_reference on public.demand_events is
  'Automatically discovered approved events cannot rely on generic directories, wiki pages, resellers or other weak reference hosts.';
