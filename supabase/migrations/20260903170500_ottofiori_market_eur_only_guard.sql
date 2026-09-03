-- Hotel Ottofiori pricing is EUR. Never mix raw HUF/USD numerics into the EUR
-- competitor median. Raw observations are retained for audit, but only verified
-- EUR observations may be reconciled into the market-rate table for Ottofiori.
create or replace function public.reconcile_competitor_rates(
  _competitor_id uuid,
  _from date,
  _to date,
  _window_hours integer default 96
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
begin
  with recent as (
    select o.*
      from public.competitor_rate_observations o
     where o.competitor_id = _competitor_id
       and o.stay_date between _from and _to
       and o.rate is not null and o.rate > 0
       and o.observed_at >= now() - make_interval(hours => _window_hours)
       and (
         o.hotel_id <> 'ottofiori'
         or upper(coalesce(o.currency, 'EUR')) = 'EUR'
       )
  ),
  med as (
    select stay_date,
           percentile_cont(0.5) within group (order by rate)::numeric as med_rate
      from recent group by stay_date
  ),
  kept as (
    select r.*, m.med_rate
      from recent r join med m using (stay_date)
     where m.med_rate > 0
       and abs(r.rate - m.med_rate) / m.med_rate <= 0.15
  ),
  agreed as (
    select k.stay_date,
           round(percentile_cont(0.5) within group (order by k.rate)::numeric, 0) as rate,
           count(*)::int as kept_n,
           (select count(*) from recent r2 where r2.stay_date = k.stay_date)::int as total_n,
           avg(coalesce(k.raw_confidence, 0.6)) as raw_conf,
           case when avg(k.rate) > 0
                then (max(k.rate) - min(k.rate)) / avg(k.rate) else 0 end as spread,
           max(k.observed_at) as observed_at,
           (array_agg(k.currency order by k.observed_at desc))[1] as currency,
           (array_agg(k.room_type order by k.observed_at desc))[1] as room_type,
           (array_agg(k.board order by k.observed_at desc))[1] as board,
           (array_agg(k.refundable order by k.observed_at desc))[1] as refundable,
           (array_agg(k.source_page_url order by k.observed_at desc))[1] as source_page_url,
           (array_agg(k.hotel_id order by k.observed_at desc))[1] as hotel_id,
           (array_agg(k.organization_slug order by k.observed_at desc))[1] as organization_slug
      from kept k group by k.stay_date
  ),
  scored as (
    select a.*,
           greatest(0.05, least(0.99,
             a.raw_conf
             * (case when a.kept_n >= 3 then 1.15 when a.kept_n = 2 then 1.05 else 0.85 end)
             * (a.kept_n::numeric / greatest(a.total_n, 1))
             * (1 - least(a.spread, 0.3))
             * (case when a.observed_at >= now() - interval '48 hours' then 1
                     when a.observed_at >= now() - interval '7 days' then 0.8
                     else 0.55 end)
           )) as confidence
      from agreed a
  ),
  upserted as (
    insert into public.competitor_rates as cr (
      competitor_id, hotel_id, organization_slug, stay_date, rate, rate_original,
      currency, currency_original, room_type, occupancy, board, refundable,
      source_page_url, confidence, source, captured_at
    )
    select _competitor_id, s.hotel_id, s.organization_slug, s.stay_date, s.rate, s.rate,
           coalesce(s.currency, 'EUR'), coalesce(s.currency, 'EUR'), s.room_type, 2, s.board, s.refundable,
           s.source_page_url, round(s.confidence, 2), 'reconciled', s.observed_at
      from scored s
    on conflict (competitor_id, stay_date) do update set
      rate = excluded.rate,
      rate_original = excluded.rate_original,
      currency = excluded.currency,
      currency_original = excluded.currency_original,
      room_type = excluded.room_type,
      board = excluded.board,
      refundable = excluded.refundable,
      source_page_url = excluded.source_page_url,
      confidence = excluded.confidence,
      source = 'reconciled',
      captured_at = excluded.captured_at
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$function$;

-- Remove already-reconciled non-EUR rows from Ottofiori market evidence. Raw
-- observations remain intact so no source data is destroyed.
delete from public.competitor_rates
where hotel_id = 'ottofiori'
  and upper(coalesce(currency, 'EUR')) <> 'EUR';