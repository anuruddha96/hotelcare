-- Booking activity is a compact, durable, tenant-scoped ledger for historic sales analytics.
-- Booking-created timestamps and cancellation timestamps are events; checkout is exclusive.
-- Capturing the revenue nightly facts here preserves them after old stay dates leave the live feed.
CREATE TABLE IF NOT EXISTS public.revenue_booking_activity_archive (
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  reservation_id text NOT NULL,
  room_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('booked', 'cancelled')),
  event_at timestamptz NOT NULL,
  arrival_date date NOT NULL,
  checkout_date date NOT NULL,
  room_nights integer NOT NULL CHECK (room_nights >= 0),
  guests integer NOT NULL DEFAULT 0,
  value_eur numeric(15,2) NOT NULL DEFAULT 0,
  room_type_name text,
  source_name text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hotel_id, reservation_id, room_key, kind, event_at)
);
CREATE INDEX IF NOT EXISTS idx_revenue_activity_hotel_time ON public.revenue_booking_activity_archive(hotel_id,event_at DESC);
ALTER TABLE public.revenue_booking_activity_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.revenue_booking_activity_archive FROM PUBLIC, anon;
GRANT SELECT ON public.revenue_booking_activity_archive TO authenticated;
CREATE POLICY "Authorized hotel staff read archived booking activity"
ON public.revenue_booking_activity_archive FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

-- This is server-only, never callable by browser clients. The data source is the
-- existing RLS-protected revenue fact tables populated by Previo revenue sync.
CREATE OR REPLACE FUNCTION public.refresh_revenue_booking_activity_archive()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE affected bigint;
BEGIN
  WITH booking_facts AS (
    SELECT
      b.hotel_id, b.organization_slug, b.res_id AS reservation_id,
      COALESCE(NULLIF(b.room_key, ''), NULLIF(b.obk_id, ''), NULLIF(b.room_type_name,''), 'room') AS room_key,
      'booked'::text AS kind, b.created_at_pms AS event_at,
      MIN(b.stay_date) AS arrival_date, (MAX(b.stay_date) + 1) AS checkout_date,
      COUNT(DISTINCT b.stay_date)::integer AS room_nights,
      MAX(COALESCE(b.guests,0))::integer AS guests,
      ROUND(SUM(COALESCE(b.nightly_price_eur,0)),2) AS value_eur,
      MAX(b.room_type_name) AS room_type_name, MAX(b.source_name) AS source_name
    FROM public.revenue_booking_nights b
    WHERE b.created_at_pms IS NOT NULL
      AND b.res_id IS NOT NULL
      AND (NULLIF(TRIM(b.source_name),'') IS NOT NULL
        OR b.stay_from IS NULL OR b.stay_to IS NULL
        OR b.stay_to - b.stay_from <= 366)
    GROUP BY b.hotel_id,b.organization_slug,b.res_id,
      COALESCE(NULLIF(b.room_key, ''), NULLIF(b.obk_id, ''), NULLIF(b.room_type_name,''), 'room'),
      b.created_at_pms
  ), cancellation_facts AS (
    SELECT
      c.hotel_id, COALESCE(c.organization_slug,b.organization_slug, 'rdhotels') AS organization_slug,
      c.res_id AS reservation_id,
      COALESCE(NULLIF(c.room_key,''),NULLIF(c.obk_id,''),NULLIF(c.room_type_name,''),'room') AS room_key,
      'cancelled'::text AS kind,c.cancelled_at AS event_at,
      MIN(c.stay_date) AS arrival_date, (MAX(c.stay_date) + 1) AS checkout_date,
      COUNT(DISTINCT c.stay_date)::integer AS room_nights,
      MAX(COALESCE(c.guests,0))::integer AS guests,
      ROUND(SUM(COALESCE(c.nightly_price_eur,0)),2) AS value_eur,
      MAX(c.room_type_name) AS room_type_name,MAX(c.source_name) AS source_name
    FROM public.revenue_cancelled_nights c
    LEFT JOIN (
      SELECT hotel_id,res_id, MAX(organization_slug) AS organization_slug
      FROM public.revenue_booking_nights GROUP BY hotel_id,res_id
    ) b ON b.hotel_id=c.hotel_id AND b.res_id=c.res_id
    WHERE c.cancelled_at IS NOT NULL
      AND c.res_id IS NOT NULL
      AND (NULLIF(TRIM(c.source_name),'') IS NOT NULL
        OR c.stay_from IS NULL OR c.stay_to IS NULL
        OR c.stay_to - c.stay_from <= 366)
    GROUP BY c.hotel_id,COALESCE(c.organization_slug,b.organization_slug,'rdhotels'),c.res_id,
      COALESCE(NULLIF(c.room_key,''),NULLIF(c.obk_id,''),NULLIF(c.room_type_name,''),'room'),
      c.cancelled_at
  ), source_events AS (
    SELECT * FROM booking_facts UNION ALL SELECT * FROM cancellation_facts
  ), upserted AS (
    INSERT INTO public.revenue_booking_activity_archive(
      hotel_id,organization_slug,reservation_id,room_key,kind,event_at,
      arrival_date,checkout_date,room_nights,guests,value_eur,room_type_name,source_name
    )
    SELECT hotel_id,organization_slug,reservation_id,room_key,kind,event_at,
      arrival_date,checkout_date,room_nights,guests,value_eur,room_type_name,source_name
    FROM source_events
    ON CONFLICT (hotel_id,reservation_id,room_key,kind,event_at)
    DO UPDATE SET
      arrival_date=EXCLUDED.arrival_date,checkout_date=EXCLUDED.checkout_date,
      room_nights=EXCLUDED.room_nights,guests=EXCLUDED.guests,value_eur=EXCLUDED.value_eur,
      room_type_name=EXCLUDED.room_type_name,source_name=EXCLUDED.source_name,
      updated_at=now()
    WHERE (revenue_booking_activity_archive.arrival_date,
           revenue_booking_activity_archive.checkout_date,
           revenue_booking_activity_archive.room_nights,
           revenue_booking_activity_archive.guests,
           revenue_booking_activity_archive.value_eur,
           revenue_booking_activity_archive.room_type_name,
           revenue_booking_activity_archive.source_name)
      IS DISTINCT FROM
          (EXCLUDED.arrival_date,EXCLUDED.checkout_date,EXCLUDED.room_nights,
           EXCLUDED.guests,EXCLUDED.value_eur,EXCLUDED.room_type_name,EXCLUDED.source_name)
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM upserted;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_revenue_booking_activity_archive() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_revenue_booking_activity_archive() TO service_role;

-- SECURITY INVOKER and explicit hotel permission check prevent tenant-wide data
-- exposure. Only aggregated figures are returned, never guest details.
CREATE OR REPLACE FUNCTION public.revenue_booking_activity_analytics(
 p_hotel_id text, p_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE answer jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.user_can_access_hotel(auth.uid(),p_hotel_id)
    OR NOT public.is_revenue_user(auth.uid()) THEN
   RAISE EXCEPTION 'Not permitted' USING ERRCODE='42501';
 END IF;
 IF p_days NOT IN (7,30,90) THEN RAISE EXCEPTION 'Unsupported analytics range'; END IF;
 WITH filtered AS (
   SELECT *, (event_at AT TIME ZONE 'Europe/Budapest')::date AS day
   FROM public.revenue_booking_activity_archive
   WHERE hotel_id=p_hotel_id
     AND (event_at AT TIME ZONE 'Europe/Budapest')::date >=
       ((now() AT TIME ZONE 'Europe/Budapest')::date - (p_days-1))
     AND (event_at AT TIME ZONE 'Europe/Budapest')::date <=
       (now() AT TIME ZONE 'Europe/Budapest')::date
 ), days AS (
   SELECT g::date AS day FROM generate_series(
     (now() AT TIME ZONE 'Europe/Budapest')::date-(p_days-1),
     (now() AT TIME ZONE 'Europe/Budapest')::date, interval '1 day') AS g
 ), by_day AS (
   SELECT d.day,
     COUNT(DISTINCT (f.reservation_id,f.event_at)) FILTER(WHERE f.kind='booked') AS bookings,
     COUNT(DISTINCT (f.reservation_id,f.event_at)) FILTER(WHERE f.kind='cancelled') AS cancellations,
     COALESCE(SUM(f.room_nights) FILTER(WHERE f.kind='booked'),0) AS gained_nights,
     COALESCE(SUM(f.room_nights) FILTER(WHERE f.kind='cancelled'),0) AS lost_nights,
     COALESCE(SUM(f.value_eur) FILTER(WHERE f.kind='booked'),0) AS booked_value,
     COALESCE(SUM(f.value_eur) FILTER(WHERE f.kind='cancelled'),0) AS cancelled_value,
     COALESCE(SUM(f.value_eur) FILTER(WHERE f.kind='booked' AND
       lower(COALESCE(f.source_name,'')) ~ '(booking|expedia|agoda|airbnb|hotelbeds|hrs|trivago|ota|hostelworld|despegar|tripadvisor)'),0) AS ota_value
   FROM days d LEFT JOIN filtered f ON f.day=d.day GROUP BY d.day
 ), by_channel AS (
   SELECT COALESCE(NULLIF(TRIM(source_name),''),'Direct / unknown') AS channel,
     COUNT(DISTINCT (reservation_id,event_at)) AS bookings,
     SUM(room_nights) AS room_nights,SUM(value_eur) AS value_eur
   FROM filtered WHERE kind='booked' GROUP BY 1 ORDER BY value_eur DESC LIMIT 8
 )
 SELECT jsonb_build_object(
   'daily',COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'day',day,'bookings',bookings,'cancellations',cancellations,
       'gained_nights',gained_nights,'lost_nights',lost_nights,
       'booked_value',booked_value,'cancelled_value',cancelled_value,
       'ota_value',ota_value) ORDER BY day) FROM by_day),'[]'::jsonb),
   'channels',COALESCE((SELECT jsonb_agg(jsonb_build_object(
       'channel',channel,'bookings',bookings,'room_nights',room_nights,
       'value_eur',value_eur)) FROM by_channel),'[]'::jsonb),
   'archive_started_at',(SELECT min(captured_at) FROM filtered)
 ) INTO answer;
 RETURN answer;
END;
$$;
REVOKE ALL ON FUNCTION public.revenue_booking_activity_analytics(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revenue_booking_activity_analytics(text,integer) TO authenticated;

-- The Previo feed is synchronised periodically. Snapshot the reservation-room
-- facts at 5 and 35 past the hour; upserts are idempotent and only write changes.
SELECT cron.schedule('revenue-booking-activity-archive-30min', '5,35 * * * *',
  'SELECT public.refresh_revenue_booking_activity_archive();');
