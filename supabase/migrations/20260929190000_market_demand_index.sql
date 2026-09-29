-- Shared market demand inputs for Revenue Management.
--
-- This deliberately returns only city-level aggregates. A caller can never
-- inspect another tenant's hotel IDs, room types, reservations or per-property
-- occupancy through this function.

create or replace function public.get_market_demand_index(
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
  v_target_org text;
  v_city text := 'Budapest';
  v_country text := 'Hungary';
  v_today date := (now() at time zone 'Europe/Budapest')::date;
  v_days integer := greatest(1, least(coalesce(_horizon_days, 210), 365));
  v_property_count integer := 0;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select p.organization_slug
    into v_user_org
  from public.profiles p
  where p.id = auth.uid()
  limit 1;

  select rp.organization_slug
    into v_target_org
  from public.revenue_published_payloads rp
  where rp.hotel_id = _hotel_id
  order by rp.sync_completed_at desc
  limit 1;

  if v_user_org is null or v_target_org is null or v_user_org <> v_target_org then
    raise exception 'Revenue hotel access denied';
  end if;

  select
    coalesce(nullif(trim(s.market_city), ''), 'Budapest'),
    coalesce(nullif(trim(s.market_country), ''), 'Hungary')
    into v_city, v_country
  from public.hotel_revenue_settings s
  where s.hotel_id = _hotel_id
    and s.organization_slug = v_target_org
  limit 1;

  with latest_payload as (
    select distinct on (rp.hotel_id)
      rp.hotel_id,
      rp.organization_slug,
      rp.payload,
      rp.sync_completed_at
    from public.revenue_published_payloads rp
    join public.hotel_revenue_settings s
      on s.hotel_id = rp.hotel_id
     and s.organization_slug = rp.organization_slug
    where lower(coalesce(nullif(trim(s.market_city), ''), 'Budapest')) = lower(v_city)
      and lower(coalesce(nullif(trim(s.market_country), ''), 'Hungary')) = lower(v_country)
      -- Exclude abandoned datasets while allowing a hotel whose PMS sync was
      -- temporarily delayed to continue contributing to the market signal.
      and rp.sync_completed_at >= now() - interval '72 hours'
    order by rp.hotel_id, rp.sync_completed_at desc
  ), capacities as (
    select
      lp.hotel_id,
      lp.organization_slug,
      lp.payload,
      lp.sync_completed_at,
      coalesce(sum(
        case
          when coalesce((rt.value->>'is_sellable')::boolean, true)
           and coalesce((rt.value->>'counts_toward_inventory')::boolean, true)
          then greatest(0, coalesce((rt.value->>'num_rooms')::integer, 0))
          else 0
        end
      ), 0)::integer as capacity
    from latest_payload lp
    left join lateral jsonb_array_elements(coalesce(lp.payload->'roomTypes', '[]'::jsonb)) rt(value) on true
    group by lp.hotel_id, lp.organization_slug, lp.payload, lp.sync_completed_at
  ), eligible as (
    select * from capacities where capacity > 0
  )
  select count(*)::integer into v_property_count from eligible;

  -- Three contributors prevents exposing another tenant's exact position by
  -- subtracting the caller's own hotel from a two-property market total.
  if v_property_count < 3 then
    return jsonb_build_object(
      'available', false,
      'marketCity', v_city,
      'marketCountry', v_country,
      'propertiesReporting', v_property_count,
      'minimumProperties', 3,
      'days', '[]'::jsonb
    );
  end if;

  with latest_payload as (
    select distinct on (rp.hotel_id)
      rp.hotel_id,
      rp.organization_slug,
      rp.payload,
      rp.sync_completed_at
    from public.revenue_published_payloads rp
    join public.hotel_revenue_settings s
      on s.hotel_id = rp.hotel_id
     and s.organization_slug = rp.organization_slug
    where lower(coalesce(nullif(trim(s.market_city), ''), 'Budapest')) = lower(v_city)
      and lower(coalesce(nullif(trim(s.market_country), ''), 'Hungary')) = lower(v_country)
      and rp.sync_completed_at >= now() - interval '72 hours'
    order by rp.hotel_id, rp.sync_completed_at desc
  ), capacities as (
    select
      lp.hotel_id,
      lp.organization_slug,
      lp.payload,
      lp.sync_completed_at,
      coalesce(sum(
        case
          when coalesce((rt.value->>'is_sellable')::boolean, true)
           and coalesce((rt.value->>'counts_toward_inventory')::boolean, true)
          then greatest(0, coalesce((rt.value->>'num_rooms')::integer, 0))
          else 0
        end
      ), 0)::integer as capacity
    from latest_payload lp
    left join lateral jsonb_array_elements(coalesce(lp.payload->'roomTypes', '[]'::jsonb)) rt(value) on true
    group by lp.hotel_id, lp.organization_slug, lp.payload, lp.sync_completed_at
  ), eligible as (
    select * from capacities where capacity > 0
  ), dates as (
    select generate_series(v_today, v_today + (v_days - 1), interval '1 day')::date as stay_date
  ), hotel_nights as (
    select
      e.hotel_id,
      e.capacity,
      (n.value->>'stay_date')::date as stay_date,
      count(*)::integer as sold,
      count(*) filter (
        where nullif(n.value->>'created_at_pms', '') is not null
          and (n.value->>'created_at_pms')::timestamptz >= now() - interval '48 hours'
      )::integer as pickup48h,
      count(*) filter (
        where nullif(n.value->>'created_at_pms', '') is not null
          and (n.value->>'created_at_pms')::timestamptz >= now() - interval '7 days'
      )::integer as pickup7d
    from eligible e
    cross join lateral jsonb_array_elements(coalesce(e.payload->'nights', '[]'::jsonb)) n(value)
    where (n.value->>'stay_date') ~ '^\d{4}-\d{2}-\d{2}$'
      and (n.value->>'stay_date')::date between v_today and v_today + (v_days - 1)
    group by e.hotel_id, e.capacity, (n.value->>'stay_date')::date
  ), hotel_days as (
    select
      d.stay_date,
      e.hotel_id,
      e.capacity,
      least(e.capacity, coalesce(hn.sold, 0))::integer as sold,
      coalesce(hn.pickup48h, 0)::integer as pickup48h,
      coalesce(hn.pickup7d, 0)::integer as pickup7d,
      case when e.capacity > 0
        then least(100.0, coalesce(hn.sold, 0)::numeric * 100.0 / e.capacity)
        else 0 end as occupancy_pct
    from dates d
    cross join eligible e
    left join hotel_nights hn
      on hn.hotel_id = e.hotel_id
     and hn.stay_date = d.stay_date
  ), market_days as (
    select
      hd.stay_date,
      sum(hd.capacity)::integer as total_rooms,
      sum(hd.sold)::integer as rooms_sold,
      count(*)::integer as properties_reporting,
      count(*) filter (where hd.occupancy_pct >= 80)::integer as properties_over_80,
      count(*) filter (where hd.occupancy_pct >= 90)::integer as properties_over_90,
      count(*) filter (
        where hd.capacity - hd.sold <= greatest(2, ceil(hd.capacity * 0.10)::integer)
      )::integer as properties_low_inventory,
      count(*) filter (where hd.sold >= hd.capacity)::integer as properties_sold_out,
      sum(hd.pickup48h)::integer as pickup_48h,
      sum(hd.pickup7d)::integer as pickup_7d
    from hotel_days hd
    group by hd.stay_date
  ), shaped as (
    select jsonb_build_object(
      'date', md.stay_date::text,
      'totalRooms', md.total_rooms,
      'roomsSold', md.rooms_sold,
      'propertiesReporting', md.properties_reporting,
      'propertiesOver80', md.properties_over_80,
      'propertiesOver90', md.properties_over_90,
      'propertiesLowInventory', md.properties_low_inventory,
      'propertiesSoldOut', md.properties_sold_out,
      'pickup48h', md.pickup_48h,
      'pickup7d', md.pickup_7d,
      'eventImpacts', coalesce((
        select jsonb_agg(ev.expected_impact order by
          case lower(coalesce(ev.expected_impact, ''))
            when 'very_high' then 4 when 'very high' then 4
            when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end desc
        )
        from public.demand_events ev
        where ev.approved = true
          and lower(coalesce(ev.city, '')) = lower(v_city)
          and lower(coalesce(ev.country, '')) = lower(v_country)
          and md.stay_date between ev.event_date and coalesce(ev.end_date, ev.event_date)
      ), '[]'::jsonb)
    ) as row
    from market_days md
    order by md.stay_date
  )
  select jsonb_build_object(
    'available', true,
    'marketCity', v_city,
    'marketCountry', v_country,
    'propertiesReporting', v_property_count,
    'minimumProperties', 3,
    'generatedAt', now(),
    'days', coalesce(jsonb_agg(shaped.row), '[]'::jsonb)
  ) into v_result
  from shaped;

  return coalesce(v_result, jsonb_build_object(
    'available', false,
    'marketCity', v_city,
    'marketCountry', v_country,
    'propertiesReporting', v_property_count,
    'minimumProperties', 3,
    'days', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_market_demand_index(text, integer) from public;
grant execute on function public.get_market_demand_index(text, integer) to authenticated;

comment on function public.get_market_demand_index(text, integer) is
  'Returns privacy-safe city-level demand inputs from latest published Revenue payloads. No per-property or cross-tenant reservation data is exposed.';
