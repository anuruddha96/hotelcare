-- Retain FIVE years of compact, PII-free nightly revenue intelligence
-- for long-term year-on-year modelling. User-facing calendar remains two years.
-- Nightly archive schedule and normal loading are unchanged.
CREATE OR REPLACE FUNCTION public.archive_revenue_calendar_days(p_from date, p_through date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  inserted integer := 0;
BEGIN
  IF p_from IS NULL OR p_through IS NULL
     OR p_from > p_through OR p_through >= v_today
     OR p_through - p_from > 740 THEN
    RAISE EXCEPTION 'Invalid historical archive date window';
  END IF;
  INSERT INTO public.revenue_calendar_history_archive (
    hotel_id, organization_slug, stay_date, rooms_sold, rooms_available,
    occupancy_pct, adr_eur, revpar_eur, revenue_eur, captured_at, rates, events
  )
  SELECT s.hotel_id, s.organization_slug, dates.stay_date,
    d.rooms_sold, d.rooms_available, d.occupancy_pct,
    d.adr_eur, d.revpar_eur, d.revenue_eur, d.captured_at,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('obk_id', r.obk_id, 'occupancy', r.occupancy,
          'price', r.price, 'room_type_name', r.room_type_name,
          'rate_plan_id', r.rate_plan_id, 'currency', r.currency,
          'captured_at', r.captured_at)
        ORDER BY r.obk_id, r.occupancy, r.rate_plan_id
      )
      FROM public.revenue_room_type_rates r
      WHERE r.hotel_id = dates.hotel_id AND r.stay_date = dates.stay_date
        AND r.source = 'previo' AND r.price > 0
        AND r.captured_at < ((dates.stay_date + 1)::timestamp AT TIME ZONE 'Europe/Budapest')
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('title', e.title, 'impact', e.expected_impact,
          'category', e.category, 'venue', e.venue, 'url', e.url,
          'start', e.event_date, 'end', COALESCE(e.end_date, e.event_date))
        ORDER BY e.event_date, e.title
      )
      FROM public.demand_events e
      WHERE e.organization_slug = s.organization_slug
        AND e.approved = true AND NULLIF(e.url, '') IS NOT NULL
        AND lower(e.city) = lower(coalesce(s.market_city, 'Budapest'))
        AND e.event_date <= dates.stay_date
        AND COALESCE(e.end_date, e.event_date) >= dates.stay_date
    ), '[]'::jsonb)
  FROM (
    SELECT hotel_id, stay_date FROM public.revenue_historical_daily
    WHERE observed_date = stay_date
      AND stay_date BETWEEN GREATEST(p_from, (v_today - interval '5 years')::date) AND p_through
    UNION
    SELECT hotel_id, stay_date FROM public.revenue_room_type_rates
    WHERE source = 'previo'
      AND stay_date BETWEEN GREATEST(p_from, (v_today - interval '5 years')::date) AND p_through
  ) dates
  JOIN public.hotel_revenue_settings s ON s.hotel_id = dates.hotel_id
  LEFT JOIN public.revenue_historical_daily d
    ON d.hotel_id = dates.hotel_id AND d.stay_date = dates.stay_date
    AND d.observed_date = dates.stay_date
  ON CONFLICT (hotel_id, stay_date) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  DELETE FROM public.revenue_calendar_history_archive
    WHERE stay_date < (v_today - interval '5 years')::date;
  RETURN inserted;
END;
$function$;
REVOKE ALL ON FUNCTION public.archive_revenue_calendar_days(date,date)
 FROM PUBLIC,anon,authenticated;
