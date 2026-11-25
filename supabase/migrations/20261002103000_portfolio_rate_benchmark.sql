-- Privacy-safe cross-tenant booked-rate benchmark for Revenue Management.
-- Returns only city-level daily aggregates. It never exposes contributor hotel IDs,
-- tenant IDs, reservations, room types, or a single property's exact ADR.
create or replace function public.get_portfolio_rate_benchmark(
  _hotel_id text,
  _horizon_days integer default 210
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_org text;
  v_is_super_admin boolean := false;
  v_target_org text;
  v_city text := 'Budapest';
  v_country text := 'Hungary';
  v_today date := (now() at time zone 'Europe/Budapest')::date;
  v_days integer := greatest(1, least(coalesce(_horizon_days, 210), 365));
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select p.organization_slug, coalesce(p.is_super_admin, false)
    into v_user_org, v_is_super_admin
  from public.profiles p where p.id = auth.uid() limit 1;

  select rp.organization_slug into v_target_org
  from public.revenue_published_payloads rp
  where rp.hotel_id = _hotel_id
    and (v_is_super_admin or rp.organization_slug = v_user_org)
  order by rp.sync_completed_at desc limit 1;

  if v_target_org is null then raise exception 'Revenue hotel access denied'; end if;

  select coalesce(nullif(trim(s.market_city), ''), 'Budapest'),
         coalesce(nullif(trim(s.market_country), ''), 'Hungary')
    into v_city, v_country
  from public.hotel_revenue_settings s
  where s.hotel_id = _hotel_id and s.organization_slug = v_target_org limit 1;

  v_city := coalesce(nullif(trim(v_city), ''), 'Budapest');
  v_country := coalesce(nullif(trim(v_country), ''), 'Hungary');

  with eligible_hotels as (
    select distinct s.hotel_id, s.organization_slug
    from public.hotel_revenue_settings s
    join public.revenue_published_payloads rp
      on rp.hotel_id = s.hotel_id and rp.organization_slug = s.organization_slug
    where lower(coalesce(nullif(trim(s.market_city), ''), 'Budapest')) = lower(v_city)
      and lower(coalesce(nullif(trim(s.market_country), ''), 'Hungary')) = lower(v_country)
      and rp.sync_completed_at >= now() - interval '72 hours'
  ), latest as (
    select distinct on (d.hotel_id, d.stay_date)
      d.hotel_id, d.stay_date, d.adr_eur
    from public.revenue_daily_snapshots d
    join eligible_hotels e on e.hotel_id = d.hotel_id
    where d.stay_date between v_today and v_today + (v_days - 1)
      and d.adr_eur is not null and d.adr_eur > 0
      and d.captured_at >= now() - interval '72 hours'
    order by d.hotel_id, d.stay_date, d.captured_at desc
  ), bounds as (
    select stay_date,
      count(*)::integer as properties_reporting,
      percentile_cont(0.1) within group (order by adr_eur)::numeric as p10,
      percentile_cont(0.5) within group (order by adr_eur)::numeric as median_rate,
      percentile_cont(0.9) within group (order by adr_eur)::numeric as p90
    from latest group by stay_date
  ), daily as (
    select b.stay_date, b.properties_reporting, b.median_rate,
      avg(l.adr_eur) filter (where l.adr_eur between b.p10 and b.p90) as trimmed_avg_rate
    from bounds b join latest l on l.stay_date = b.stay_date
    group by b.stay_date, b.properties_reporting, b.median_rate
  ), shaped as (
    select jsonb_build_object(
      'date', stay_date::text,
      'propertiesReporting', properties_reporting,
      'medianRate', round(median_rate),
      'trimmedAverageRate', round(coalesce(trimmed_avg_rate, median_rate))
    ) as row
    from daily
    where properties_reporting >= 3
    order by stay_date
  ), contributor_count as (
    select count(*)::integer as value from eligible_hotels
  )
  select jsonb_build_object(
    'available', cc.value >= 3,
    'marketCity', v_city,
    'marketCountry', v_country,
    'propertiesReporting', cc.value,
    'minimumProperties', 3,
    'source', 'hotelcare_portfolio_booked_adr',
    'generatedAt', now(),
    'days', case when cc.value >= 3
      then coalesce(jsonb_agg(shaped.row) filter (where shaped.row is not null), '[]'::jsonb)
      else '[]'::jsonb end
  ) into v_result
  from contributor_count cc left join shaped on cc.value >= 3
  group by cc.value;

  return coalesce(v_result, jsonb_build_object(
    'available', false, 'marketCity', v_city, 'marketCountry', v_country,
    'propertiesReporting', 0, 'minimumProperties', 3,
    'source', 'hotelcare_portfolio_booked_adr', 'days', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_portfolio_rate_benchmark(text, integer) from public;
grant execute on function public.get_portfolio_rate_benchmark(text, integer) to authenticated;
comment on function public.get_portfolio_rate_benchmark(text, integer) is
  'Privacy-safe city-level booked ADR benchmark across HotelCare properties; minimum three contributors.';
