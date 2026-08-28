CREATE OR REPLACE FUNCTION public.refresh_revenue_published_payload(_hotel_id text, _completed_at timestamp with time zone DEFAULT now(), _actor_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_from date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_to date := v_from + 365;
  v_payload jsonb;
BEGIN
  SELECT o.slug INTO v_org
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = _hotel_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Unknown hotel';
  END IF;

  -- Freeze / release the price each room type sold out at before publishing.
  PERFORM public.capture_revenue_soldout_prices(_hotel_id);

  SELECT jsonb_build_object(
    'roomTypes', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.sort_order, r.name)
      FROM (
        SELECT id, name, pms_room_id, num_rooms, is_reference, derivation_mode,
               derivation_value, sort_order, is_sellable, counts_toward_inventory,
               name_translations
        FROM public.room_types
        WHERE hotel_id = _hotel_id
      ) r
    ), '[]'::jsonb),
    'nights', COALESCE((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.stay_date, n.res_id, n.room_key)
      FROM (
        SELECT stay_date, res_id, room_key, obk_id, room_type_name,
               nightly_price_eur, total_price_eur, stay_from, stay_to,
               source_name, created_at_pms, guests
        FROM public.revenue_booking_nights
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
      ) n
    ), '[]'::jsonb),
    'rates', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.stay_date, r.obk_id, r.occupancy)
      FROM (
        SELECT DISTINCT ON (stay_date, obk_id, occupancy)
               stay_date, obk_id, room_type_name, occupancy, price, currency,
               rate_plan_id, captured_at, updated_at
        FROM public.revenue_room_type_rates
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
        ORDER BY stay_date, obk_id, occupancy, captured_at DESC, updated_at DESC
      ) r
    ), '[]'::jsonb),
    'soldOutPrices', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stay_date, s.room_type_name, s.occupancy)
      FROM (
        SELECT room_type_name, stay_date, occupancy, price, currency, captured_at
        FROM public.revenue_soldout_prices
        WHERE hotel_id = _hotel_id
          AND released_at IS NULL
          AND stay_date BETWEEN v_from AND v_to
      ) s
    ), '[]'::jsonb),
    'cancellations', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.stay_date, c.res_id, c.room_key)
      FROM (
        SELECT stay_date, res_id, room_key, obk_id, room_type_name,
               nightly_price_eur, total_price_eur, stay_from, stay_to,
               source_name, created_at_pms, guests, cancelled_at
        FROM public.revenue_cancelled_nights
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
      ) c
    ), '[]'::jsonb),
    'snapshots', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stay_date)
      FROM (
        SELECT DISTINCT ON (stay_date)
               stay_date, captured_date, captured_at, rooms_sold,
               rooms_available, occupancy_pct, revenue_eur, adr_eur, new_bookings
        FROM public.revenue_daily_snapshots
        WHERE hotel_id = _hotel_id AND stay_date BETWEEN v_from AND v_to
        ORDER BY stay_date, captured_at DESC
      ) s
    ), '[]'::jsonb),
    'movements', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.stay_date, m.captured_at)
      FROM (
        SELECT stay_date, date_trunc('hour', captured_at) AS captured_at,
               sum(delta)::integer AS delta
        FROM public.pickup_snapshots
        WHERE hotel_id = _hotel_id
          AND stay_date BETWEEN v_from AND v_to
          AND captured_at >= now() - interval '92 days'
          AND delta <> 0
        GROUP BY stay_date, date_trunc('hour', captured_at)
      ) m
    ), '[]'::jsonb),
    'settings', COALESCE((
      SELECT to_jsonb(s)
      FROM (
        SELECT sellable_rooms, rate_warn_below_eur, rate_critical_below_eur,
               rate_max_sane_eur, occupancy_low_pct, occupancy_high_pct,
               pickup_strong_threshold, base_currency, eur_conversion_rate
        FROM public.hotel_revenue_settings
        WHERE hotel_id = _hotel_id
      ) s
    ), '{}'::jsonb)
  ) INTO v_payload;

  INSERT INTO public.revenue_published_payloads (
    hotel_id, organization_slug, sync_completed_at, sync_completed_by_name,
    horizon_from, horizon_to, payload, updated_at
  ) VALUES (
    _hotel_id, v_org, _completed_at, NULLIF(left(COALESCE(_actor_name, ''), 200), ''),
    v_from, v_to, v_payload, now()
  )
  ON CONFLICT (hotel_id) DO UPDATE SET
    organization_slug = EXCLUDED.organization_slug,
    sync_completed_at = EXCLUDED.sync_completed_at,
    sync_completed_by_name = EXCLUDED.sync_completed_by_name,
    horizon_from = EXCLUDED.horizon_from,
    horizon_to = EXCLUDED.horizon_to,
    payload = EXCLUDED.payload,
    updated_at = now();
END;
$function$;
