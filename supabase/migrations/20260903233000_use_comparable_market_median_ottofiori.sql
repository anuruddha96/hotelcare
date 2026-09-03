-- Hotel Ottofiori: build the market signal from comparable products, not a
-- mixture of breakfast, non-refundable, suite/family and standard-room offers.
--
-- Raw observations remain untouched for audit.  competitor_rates becomes the
-- reconciled comparable layer consumed by revenue-pickup-automation and the
-- daily market calendar view.

create or replace function public.reconcile_competitor_rates(
  _competitor_id uuid,
  _from date,
  _to date,
  _window_hours integer default 96
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_hotel_id text;
  v_organization_slug text;
begin
  select p.hotel_id, p.organization_slug
    into v_hotel_id, v_organization_slug
    from public.competitor_properties p
   where p.id = _competitor_id;

  -- Preserve the established reconciliation behaviour for every other hotel.
  if coalesce(v_hotel_id, '') <> 'ottofiori' then
    with recent as (
      select o.*
        from public.competitor_rate_observations o
       where o.competitor_id = _competitor_id
         and o.stay_date between _from and _to
         and o.rate is not null and o.rate > 0
         and o.observed_at >= now() - make_interval(hours => _window_hours)
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
             coalesce(s.currency, 'EUR'), coalesce(s.currency, 'EUR'), s.room_type, 2,
             s.board, s.refundable, s.source_page_url, round(s.confidence, 2),
             'reconciled', s.observed_at
        from scored s
      on conflict (competitor_id, stay_date) do update set
        rate = excluded.rate,
        rate_original = excluded.rate_original,
        currency = excluded.currency,
        currency_original = excluded.currency_original,
        room_type = excluded.room_type,
        occupancy = excluded.occupancy,
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
  end if;

  -- Ottofiori comparable-market contract:
  --   * 2 adults
  --   * EUR
  --   * room-only
  --   * standard double/twin-like inventory (no suites/apartments/family/etc.)
  --   * confidence >= 0.55
  --   * prefer refundable; fall back to non-refundable, then unknown terms
  --   * never use observations older than 30h for the daily market signal
  --
  -- Remove the old reconciled layer for the requested range first. If no
  -- comparable product exists on a date, no market signal is safer than a
  -- misleading one assembled from unlike products.
  delete from public.competitor_rates
   where competitor_id = _competitor_id
     and stay_date between _from and _to;

  with candidates as (
    select o.*,
           case
             when coalesce(o.occupancy, 2) <> 2 then 99
             when lower(trim(coalesce(o.board, 'room_only'))) not in
                  ('room_only', 'room only', 'room-only', '') then 99
             when lower(coalesce(o.room_type, '')) ~
                  '(suite|apartment|family|triple|quadruple|quad room|studio|penthouse|connecting|two[- ]bedroom|three[- ]bedroom|extra bed)' then 99
             when coalesce(o.raw_confidence, 0.6) < 0.55 then 99
             when o.refundable is true then 0
             when o.refundable is false then 1
             else 2
           end as product_rank
      from public.competitor_rate_observations o
     where o.competitor_id = _competitor_id
       and o.hotel_id = 'ottofiori'
       and o.organization_slug = v_organization_slug
       and o.stay_date between _from and _to
       and o.rate is not null and o.rate > 0
       and upper(coalesce(o.currency, 'EUR')) = 'EUR'
       and o.observed_at >= now() - make_interval(hours => least(greatest(_window_hours, 1), 30))
  ),
  best_rank as (
    select stay_date, min(product_rank) as product_rank
      from candidates
     where product_rank < 99
     group by stay_date
  ),
  comparable as (
    select c.*
      from candidates c
      join best_rank b using (stay_date, product_rank)
  ),
  med as (
    select stay_date,
           percentile_cont(0.5) within group (order by rate)::numeric as med_rate
      from comparable
     group by stay_date
  ),
  kept as (
    select c.*, m.med_rate
      from comparable c
      join med m using (stay_date)
     where m.med_rate > 0
       and abs(c.rate - m.med_rate) / m.med_rate <= 0.15
  ),
  agreed as (
    select k.stay_date,
           round(percentile_cont(0.5) within group (order by k.rate)::numeric, 0) as rate,
           count(*)::int as kept_n,
           (select count(*) from comparable c2 where c2.stay_date = k.stay_date)::int as total_n,
           avg(coalesce(k.raw_confidence, 0.6)) as raw_conf,
           case when avg(k.rate) > 0
                then (max(k.rate) - min(k.rate)) / avg(k.rate) else 0 end as spread,
           max(k.observed_at) as observed_at,
           min(k.product_rank) as product_rank,
           (array_agg(k.room_type order by k.observed_at desc))[1] as room_type,
           (array_agg(k.board order by k.observed_at desc))[1] as board,
           (array_agg(k.refundable order by k.observed_at desc))[1] as refundable,
           (array_agg(k.source_page_url order by k.observed_at desc))[1] as source_page_url
      from kept k
     group by k.stay_date
  ),
  scored as (
    select a.*,
           greatest(0.05, least(0.99,
             a.raw_conf
             * (case when a.kept_n >= 3 then 1.15 when a.kept_n = 2 then 1.05 else 0.85 end)
             * (a.kept_n::numeric / greatest(a.total_n, 1))
             * (1 - least(a.spread, 0.3))
           )) as confidence
      from agreed a
  ),
  upserted as (
    insert into public.competitor_rates as cr (
      competitor_id, hotel_id, organization_slug, stay_date, rate, rate_original,
      currency, currency_original, room_type, occupancy, board, refundable,
      source_page_url, confidence, source, captured_at
    )
    select _competitor_id, 'ottofiori', v_organization_slug, s.stay_date, s.rate, s.rate,
           'EUR', 'EUR', s.room_type, 2, coalesce(s.board, 'room_only'), s.refundable,
           s.source_page_url, round(s.confidence, 2),
           case s.product_rank
             when 0 then 'reconciled_comparable_refundable'
             when 1 then 'reconciled_comparable_nonref'
             else 'reconciled_comparable_terms_unknown'
           end,
           s.observed_at
      from scored s
    on conflict (competitor_id, stay_date) do update set
      hotel_id = excluded.hotel_id,
      organization_slug = excluded.organization_slug,
      rate = excluded.rate,
      rate_original = excluded.rate_original,
      currency = excluded.currency,
      currency_original = excluded.currency_original,
      room_type = excluded.room_type,
      occupancy = excluded.occupancy,
      board = excluded.board,
      refundable = excluded.refundable,
      source_page_url = excluded.source_page_url,
      confidence = excluded.confidence,
      source = excluded.source,
      captured_at = excluded.captured_at
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

comment on function public.reconcile_competitor_rates(uuid, date, date, integer) is
  'Reconciles competitor observations. Ottofiori uses a comparable 2-adult, room-only standard-room product hierarchy before market median calculation.';

-- A comparable median should have breadth: two hotels is too fragile for a
-- commercial price move.  Three distinct valid competitors is the minimum;
-- more are used whenever available.
update public.revenue_pickup_automation_rules
set market_validation = jsonb_set(
      jsonb_set(coalesce(market_validation, '{}'::jsonb), '{min_competitors}', '3'::jsonb, true),
      '{max_age_hours}', '30'::jsonb, true
    ),
    competitor_max_age_hours_near = 30,
    updated_at = now()
where hotel_id = 'ottofiori'
  and organization_slug = 'rdhotels';

-- Rebuild the live comparable layer now, while preserving every raw scrape.
do $$
declare
  r record;
begin
  for r in
    select id
      from public.competitor_properties
     where hotel_id = 'ottofiori'
       and organization_slug = 'rdhotels'
       and active is true
  loop
    perform public.reconcile_competitor_rates(r.id, current_date, current_date + 90, 30);
  end loop;
end;
$$;