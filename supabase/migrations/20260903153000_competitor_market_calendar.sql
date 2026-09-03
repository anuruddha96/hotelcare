-- Competitor market calendar for HotelCare revenue management.
--
-- The calendar shows an arithmetic average of fresh, validated competitor rates
-- for each stay date. We keep the raw average for auditability, but statistical
-- outliers are removed from the displayed market average so one malformed quote
-- cannot make the market look artificially expensive. The pricing engine keeps
-- its separate median/outlier safety logic.

drop view if exists public.revenue_competitor_market_daily;

create view public.revenue_competitor_market_daily
with (security_invoker = true)
as
with active_competitors as (
  select hotel_id, organization_slug, count(*)::int as active_competitor_count
  from public.competitor_properties
  where active = true
  group by hotel_id, organization_slug
),
latest_valid as (
  select distinct on (cr.hotel_id, cr.organization_slug, cr.stay_date, cr.competitor_id)
    cr.hotel_id,
    cr.organization_slug,
    cr.stay_date,
    cr.competitor_id,
    cp.name as competitor_name,
    cr.rate,
    upper(coalesce(cr.currency, '')) as currency,
    cr.confidence,
    cr.captured_at,
    cr.source,
    cr.source_page_url,
    cr.room_type,
    cr.board,
    cr.refundable
  from public.competitor_rates cr
  join public.competitor_properties cp
    on cp.id = cr.competitor_id
   and cp.hotel_id = cr.hotel_id
   and cp.organization_slug = cr.organization_slug
   and cp.active = true
  where cr.rate is not null
    and cr.rate > 0
    and upper(coalesce(cr.currency, '')) = 'EUR'
    and cr.captured_at >= now() - interval '30 hours'
  order by cr.hotel_id, cr.organization_slug, cr.stay_date, cr.competitor_id, cr.captured_at desc
),
stats as (
  select
    hotel_id,
    organization_slug,
    stay_date,
    count(*)::int as raw_count,
    avg(rate)::numeric as raw_average,
    percentile_cont(0.25) within group (order by rate)::numeric as q1,
    percentile_cont(0.5) within group (order by rate)::numeric as raw_median,
    percentile_cont(0.75) within group (order by rate)::numeric as q3
  from latest_valid
  group by hotel_id, organization_slug, stay_date
),
scored as (
  select
    v.*,
    s.raw_count,
    s.raw_average,
    s.raw_median,
    s.q1,
    s.q3,
    case
      when s.raw_count >= 4 then
        v.rate between (s.q1 - 1.5 * (s.q3 - s.q1)) and (s.q3 + 1.5 * (s.q3 - s.q1))
      else
        v.rate between (s.raw_median * 0.5) and (s.raw_median * 2.0)
    end as included_in_market_average
  from latest_valid v
  join stats s using (hotel_id, organization_slug, stay_date)
),
validated as (
  select * from scored where included_in_market_average
)
select
  s.hotel_id,
  s.organization_slug,
  s.stay_date,
  a.active_competitor_count,
  s.raw_count as observed_competitor_count,
  count(v.competitor_id)::int as validated_competitor_count,
  (s.raw_count - count(v.competitor_id))::int as excluded_outlier_count,
  round(avg(v.rate)::numeric, 0) as average_rate_eur,
  round(percentile_cont(0.5) within group (order by v.rate)::numeric, 0) as median_rate_eur,
  min(v.rate) as min_rate_eur,
  max(v.rate) as max_rate_eur,
  round(s.raw_average, 0) as raw_average_rate_eur,
  max(v.captured_at) as freshest_captured_at,
  jsonb_agg(
    jsonb_build_object(
      'competitor_id', v.competitor_id,
      'name', v.competitor_name,
      'rate_eur', v.rate,
      'confidence', v.confidence,
      'captured_at', v.captured_at,
      'source', v.source,
      'source_page_url', v.source_page_url,
      'room_type', v.room_type,
      'board', v.board,
      'refundable', v.refundable
    ) order by v.rate asc, v.competitor_name asc
  ) filter (where v.competitor_id is not null) as competitors,
  (
    select jsonb_agg(
      jsonb_build_object(
        'competitor_id', x.competitor_id,
        'name', x.competitor_name,
        'rate_eur', x.rate,
        'confidence', x.confidence,
        'captured_at', x.captured_at,
        'source_page_url', x.source_page_url,
        'reason', 'statistical_outlier'
      ) order by x.rate desc
    )
    from scored x
    where x.hotel_id = s.hotel_id
      and x.organization_slug = s.organization_slug
      and x.stay_date = s.stay_date
      and not x.included_in_market_average
  ) as excluded_competitors
from stats s
join active_competitors a
  on a.hotel_id = s.hotel_id
 and a.organization_slug = s.organization_slug
left join validated v
  on v.hotel_id = s.hotel_id
 and v.organization_slug = s.organization_slug
 and v.stay_date = s.stay_date
group by
  s.hotel_id,
  s.organization_slug,
  s.stay_date,
  a.active_competitor_count,
  s.raw_count,
  s.raw_average;

grant select on public.revenue_competitor_market_daily to authenticated;

-- The 06:00 Budapest scan fans out one independent request per active
-- competitor. A blocked/slow landing page can no longer prevent the rest of the
-- comp set from completing. The Edge Function owns per-competitor leases.
create or replace function public.invoke_ottofiori_market_scan(_force boolean default false)
returns bigint
language plpgsql
security definer
set search_path to 'public','cron','net'
as $function$
declare
  _anon_key text;
  _request_id bigint;
  _last_request_id bigint := null;
  _competitor record;
begin
  if not _force and extract(hour from timezone('Europe/Budapest', now())) <> 6 then
    return null;
  end if;

  select (regexp_match(command, 'apikey[^A-Za-z0-9_-]+([A-Za-z0-9._-]+)'))[1]
    into _anon_key
  from cron.job
  where jobname = 'revenue-automation-scheduler-10min'
  limit 1;

  if _anon_key is null then
    raise exception 'Could not resolve project anon key from internal cron configuration';
  end if;

  for _competitor in
    select id
    from public.competitor_properties
    where hotel_id = 'ottofiori'
      and active = true
    order by name
  loop
    select net.http_post(
      url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/ottofiori-market-scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', _anon_key,
        'Authorization', 'Bearer ' || _anon_key
      ),
      body := jsonb_build_object('days', 60, 'competitorId', _competitor.id::text)
    ) into _request_id;
    _last_request_id := _request_id;
  end loop;

  return _last_request_id;
end;
$function$;
