-- Compact two-year venue calendar archive; migration applied 20261101191243.
-- One immutable record per hotel/stay date. No guest PII.
CREATE TABLE IF NOT EXISTS public.revenue_calendar_history_archive (
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  rooms_sold integer,
  rooms_available integer,
  occupancy_pct numeric(6,2),
  adr_eur numeric(12,2),
  revpar_eur numeric(12,2),
  revenue_eur numeric(14,2),
  captured_at timestamptz,
  rates jsonb NOT NULL DEFAULT '[]'::jsonb,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_calendar_history_archive_pkey PRIMARY KEY (hotel_id, stay_date),
  CONSTRAINT revenue_calendar_history_archive_rates_array CHECK (jsonb_typeof(rates) = 'array'),
  CONSTRAINT revenue_calendar_history_archive_events_array CHECK (jsonb_typeof(events) = 'array')
);
ALTER TABLE public.revenue_calendar_history_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.revenue_calendar_history_archive FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.revenue_calendar_history_archive TO authenticated;
DROP POLICY IF EXISTS revenue_calendar_history_archive_read ON public.revenue_calendar_history_archive;
CREATE POLICY revenue_calendar_history_archive_read ON public.revenue_calendar_history_archive
FOR SELECT TO authenticated
USING ((select auth.uid()) IS NOT NULL AND public.user_can_access_hotel((select auth.uid()), hotel_id));
COMMENT ON TABLE public.revenue_calendar_history_archive IS
'Two-year rolling historical calendar. One captured daily snapshot per hotel, with saved Previo rate cells and recorded demand events. No guest personal data. Read only on date selection.';

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
  SELECT s.hotel_id, s.organization_slug, d.stay_date,
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
      WHERE r.hotel_id = d.hotel_id AND r.stay_date = d.stay_date
        AND r.source = 'previo' AND r.price > 0
        AND r.captured_at < ((d.stay_date + 1)::timestamp AT TIME ZONE 'Europe/Budapest')
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
        AND e.event_date <= d.stay_date
        AND COALESCE(e.end_date, e.event_date) >= d.stay_date
    ), '[]'::jsonb)
  FROM public.revenue_historical_daily d
  JOIN public.hotel_revenue_settings s ON s.hotel_id = d.hotel_id
  WHERE d.observed_date = d.stay_date
    AND d.stay_date BETWEEN GREATEST(p_from, (v_today - interval '2 years')::date) AND p_through
  ON CONFLICT (hotel_id, stay_date) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  DELETE FROM public.revenue_calendar_history_archive
    WHERE stay_date < (v_today - interval '2 years')::date;
  RETURN inserted;
END;
$function$

REVOKE ALL ON FUNCTION public.archive_revenue_calendar_days(date, date) FROM PUBLIC, anon, authenticated;
SELECT cron.schedule(
  'revenue-calendar-history-daily',
  '30 5 * * *',
  $$SELECT public.archive_revenue_calendar_days(
    ((now() AT TIME ZONE 'Europe/Budapest')::date - 3),
    ((now() AT TIME ZONE 'Europe/Budapest')::date - 1)
  );$$
);
