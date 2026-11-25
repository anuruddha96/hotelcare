-- Read-only Previo activity decision board. Room-night values are historical
-- pickup observations, not collected revenue; cancellations are NOT a same-
-- cohort cancellation rate. LOS/lead use captured scheduled terms ONLY.
CREATE OR REPLACE FUNCTION public.revenue_booking_insights_v2(
  p_hotel_id text, p_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE response jsonb;
BEGIN
  IF auth.uid() IS NULL
    OR NOT public.user_can_access_hotel(auth.uid(), p_hotel_id)
    OR NOT public.is_revenue_user(auth.uid()) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE='42501';
  END IF;
  IF p_days NOT IN (7,30,90) THEN
    RAISE EXCEPTION 'Unsupported analytics period' USING ERRCODE='22023';
  END IF;
  WITH dates AS (
    SELECT (now() AT TIME ZONE 'Europe/Budapest')::date AS today
  ), windowed AS (
    SELECT a.*, (a.event_at AT TIME ZONE 'Europe/Budapest')::date AS day,
      s.scheduled_arrival,s.scheduled_checkout,
      CASE WHEN s.scheduled_checkout>s.scheduled_arrival
           THEN s.scheduled_checkout-s.scheduled_arrival END AS los,
      CASE WHEN s.scheduled_arrival IS NOT NULL
           THEN s.scheduled_arrival-(a.event_at AT TIME ZONE 'Europe/Budapest')::date END AS lead_days
    FROM public.revenue_booking_activity_archive a
    LEFT JOIN public.revenue_booking_stay_context s
      ON s.hotel_id=a.hotel_id AND s.reservation_id=a.reservation_id
     AND s.room_key=a.room_key AND s.kind=a.kind AND s.event_at=a.event_at
    CROSS JOIN dates d
    WHERE a.hotel_id=p_hotel_id
      AND (a.event_at AT TIME ZONE 'Europe/Budapest')::date BETWEEN d.today-(p_days-1) AND d.today
  ), preceding AS (
    SELECT a.*, (a.event_at AT TIME ZONE 'Europe/Budapest')::date AS day
    FROM public.revenue_booking_activity_archive a CROSS JOIN dates d
    WHERE a.hotel_id=p_hotel_id AND
     (a.event_at AT TIME ZONE 'Europe/Budapest')::date BETWEEN d.today-(2*p_days-1) AND d.today-p_days
  ), calendar AS (
    SELECT x::date AS day FROM dates d,
      generate_series(d.today-(p_days-1),d.today,interval '1 day') x
  ), daily AS (
    SELECT d.day,
      COUNT(DISTINCT (w.reservation_id,w.event_at)) FILTER (WHERE w.kind='booked') AS bookings,
      COUNT(DISTINCT (w.reservation_id,w.event_at)) FILTER (WHERE w.kind='cancelled') AS cancellations,
      COALESCE(SUM(w.room_nights) FILTER (WHERE w.kind='booked'),0) AS booked_nights,
      COALESCE(SUM(w.room_nights) FILTER (WHERE w.kind='cancelled'),0) AS cancelled_nights,
      COALESCE(SUM(w.value_eur) FILTER (WHERE w.kind='booked'),0) AS booked_value,
      COALESCE(SUM(w.value_eur) FILTER (WHERE w.kind='cancelled'),0) AS cancelled_value
    FROM calendar d LEFT JOIN windowed w ON w.day=d.day GROUP BY d.day
  ), summary AS (
    SELECT
      COUNT(DISTINCT (reservation_id,event_at)) FILTER (WHERE kind='booked') AS bookings,
      COUNT(DISTINCT (reservation_id,event_at)) FILTER (WHERE kind='cancelled') AS cancellations,
      COUNT(*) FILTER (WHERE kind='booked') AS booked_room_items,
      COUNT(*) FILTER (WHERE kind='booked' AND los IS NOT NULL) AS known_los_items,
      COALESCE(SUM(room_nights) FILTER (WHERE kind='booked'),0) AS booked_nights,
      COALESCE(SUM(room_nights) FILTER (WHERE kind='cancelled'),0) AS cancelled_nights,
      COALESCE(SUM(value_eur) FILTER (WHERE kind='booked'),0) AS booked_value,
      COALESCE(SUM(value_eur) FILTER (WHERE kind='cancelled'),0) AS cancelled_value,
      ROUND(AVG(los) FILTER (WHERE kind='booked' AND los BETWEEN 1 AND 366),1) AS avg_los,
      ROUND(AVG(lead_days) FILTER (WHERE kind='booked' AND lead_days >= 0),1) AS avg_booking_lead,
      ROUND(AVG(lead_days) FILTER (WHERE kind='cancelled' AND lead_days >= 0),1) AS avg_cancel_lead,
      COUNT(*) FILTER (WHERE kind='cancelled' AND lead_days < 0) AS cancellations_after_arrival,
      COUNT(*) FILTER (WHERE kind='booked' AND lead_days < 0) AS bookings_after_arrival,
      COUNT(*) FILTER (WHERE kind='booked' AND source_name IS NULL) AS unknown_channels
    FROM windowed
  ), previous_summary AS (
    SELECT COUNT(DISTINCT (reservation_id,event_at)) FILTER (WHERE kind='booked') AS bookings,
      COUNT(DISTINCT (reservation_id,event_at)) FILTER (WHERE kind='cancelled') AS cancellations,
      COALESCE(SUM(value_eur) FILTER (WHERE kind='booked'),0) AS booked_value,
      COALESCE(SUM(value_eur) FILTER (WHERE kind='cancelled'),0) AS cancelled_value
    FROM preceding
  ), channels AS (
    SELECT COALESCE(NULLIF(TRIM(source_name),''),'Unknown source') AS name,
      COUNT(DISTINCT (reservation_id,event_at)) AS bookings,
      COUNT(*) AS room_stays,
      SUM(room_nights) AS room_nights,
      SUM(value_eur) AS value_eur,
      ROUND(SUM(value_eur)/NULLIF(SUM(room_nights),0),2) AS adr
    FROM windowed WHERE kind='booked'
    GROUP BY 1 ORDER BY value_eur DESC LIMIT 10
  ), room_types AS (
    SELECT COALESCE(NULLIF(TRIM(room_type_name),''),'Unmapped room type') AS name,
      COUNT(DISTINCT (reservation_id,event_at)) AS bookings,
      COUNT(*) AS room_stays,
      SUM(room_nights) AS room_nights,
      SUM(value_eur) AS value_eur,
      ROUND(SUM(value_eur)/NULLIF(SUM(room_nights),0),2) AS adr
    FROM windowed WHERE kind='booked'
    GROUP BY 1 ORDER BY value_eur DESC LIMIT 12
  ), los_chart AS (
    SELECT CASE
        WHEN los=1 THEN '1 night' WHEN los=2 THEN '2 nights'
        WHEN los=3 THEN '3 nights' WHEN los BETWEEN 4 AND 5 THEN '4–5 nights'
        WHEN los BETWEEN 6 AND 7 THEN '6–7 nights'
        WHEN los BETWEEN 8 AND 14 THEN '8–14 nights'
        ELSE '15+ nights' END AS bucket,
      CASE WHEN los=1 THEN 1 WHEN los=2 THEN 2 WHEN los=3 THEN 3
        WHEN los<=5 THEN 4 WHEN los<=7 THEN 5 WHEN los<=14 THEN 6 ELSE 7 END AS order_key,
      COUNT(*) AS room_stays,COALESCE(SUM(value_eur),0) AS booked_value
    FROM windowed WHERE kind='booked' AND los BETWEEN 1 AND 366
    GROUP BY 1,2
  ), booking_lead_chart AS (
    SELECT CASE
      WHEN lead_days<0 THEN 'After arrival' WHEN lead_days<=1 THEN '0–1 day'
      WHEN lead_days<=3 THEN '2–3 days' WHEN lead_days<=7 THEN '4–7 days'
      WHEN lead_days<=14 THEN '8–14 days' WHEN lead_days<=30 THEN '15–30 days'
      WHEN lead_days<=60 THEN '31–60 days' ELSE '61+ days' END AS bucket,
      CASE WHEN lead_days<0 THEN 0 WHEN lead_days<=1 THEN 1 WHEN lead_days<=3 THEN 2
           WHEN lead_days<=7 THEN 3 WHEN lead_days<=14 THEN 4 WHEN lead_days<=30 THEN 5
           WHEN lead_days<=60 THEN 6 ELSE 7 END AS order_key,
      COUNT(*) AS room_stays
    FROM windowed WHERE kind='booked' AND lead_days IS NOT NULL
    GROUP BY 1,2
  ), cancel_lead_chart AS (
    SELECT CASE
      WHEN lead_days<0 THEN 'After arrival' WHEN lead_days<=1 THEN '0–1 day'
      WHEN lead_days<=3 THEN '2–3 days' WHEN lead_days<=7 THEN '4–7 days'
      WHEN lead_days<=14 THEN '8–14 days' WHEN lead_days<=30 THEN '15–30 days'
      WHEN lead_days<=60 THEN '31–60 days' ELSE '61+ days' END AS bucket,
      CASE WHEN lead_days<0 THEN 0 WHEN lead_days<=1 THEN 1 WHEN lead_days<=3 THEN 2
           WHEN lead_days<=7 THEN 3 WHEN lead_days<=14 THEN 4 WHEN lead_days<=30 THEN 5
           WHEN lead_days<=60 THEN 6 ELSE 7 END AS order_key,
      COUNT(*) AS cancelled_room_stays,
      COALESCE(SUM(value_eur),0) AS cancelled_value
    FROM windowed WHERE kind='cancelled' AND lead_days IS NOT NULL
    GROUP BY 1,2
  ), arrival_month AS (
    SELECT TO_CHAR(scheduled_arrival,'YYYY-MM') AS month,
      COUNT(DISTINCT (reservation_id,event_at)) AS bookings,
      COUNT(*) AS room_stays,
      SUM(value_eur) AS booked_value
    FROM windowed WHERE kind='booked' AND scheduled_arrival IS NOT NULL
    GROUP BY 1 ORDER BY 1
  ), weekdays AS (
    SELECT EXTRACT(ISODOW FROM day)::int AS weekday,
      COUNT(DISTINCT (reservation_id,event_at)) AS bookings,
      COALESCE(SUM(value_eur),0) AS booked_value
    FROM windowed WHERE kind='booked' GROUP BY 1 ORDER BY 1
  ), cohorts AS (
    SELECT reservation_id,MIN(event_at) AS created_at
    FROM windowed WHERE kind='booked' GROUP BY reservation_id
  ), cohort_summary AS (
    SELECT COUNT(*) AS booked_reservations,
      COUNT(*) FILTER(WHERE EXISTS (
        SELECT 1 FROM public.revenue_booking_activity_archive cancelled
        WHERE cancelled.hotel_id=p_hotel_id AND cancelled.reservation_id=b.reservation_id
          AND cancelled.kind='cancelled' AND cancelled.event_at>=b.created_at
      )) AS ever_had_cancelled_nights
    FROM cohorts b
  )
  SELECT jsonb_build_object(
    'period_days',p_days,
    'summary',(SELECT TO_JSONB(x) FROM summary x),
    'previous',(SELECT TO_JSONB(x) FROM previous_summary x),
    'cohort',(SELECT TO_JSONB(x) FROM cohort_summary x),
    'daily',COALESCE((SELECT jsonb_agg(TO_JSONB(x) ORDER BY day) FROM daily x),'[]'::jsonb),
    'channels',COALESCE((SELECT jsonb_agg(TO_JSONB(x) ORDER BY value_eur DESC) FROM channels x),'[]'::jsonb),
    'room_types',COALESCE((SELECT jsonb_agg(TO_JSONB(x) ORDER BY value_eur DESC) FROM room_types x),'[]'::jsonb),
    'los',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'bucket',bucket,'count',room_stays,'value_eur',booked_value) ORDER BY order_key) FROM los_chart),'[]'::jsonb),
    'booking_lead',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'bucket',bucket,'count',room_stays) ORDER BY order_key) FROM booking_lead_chart),'[]'::jsonb),
    'cancellation_lead',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'bucket',bucket,'count',cancelled_room_stays,'value_eur',cancelled_value) ORDER BY order_key) FROM cancel_lead_chart),'[]'::jsonb),
    'arrival_months',COALESCE((SELECT jsonb_agg(TO_JSONB(x) ORDER BY month) FROM arrival_month x),'[]'::jsonb),
    'weekdays',COALESCE((SELECT jsonb_agg(TO_JSONB(x) ORDER BY weekday) FROM weekdays x),'[]'::jsonb),
    'first_cancellation_recorded_at',(SELECT MIN(event_at) FROM public.revenue_booking_activity_archive
       WHERE hotel_id=p_hotel_id AND kind='cancelled'),
    'first_archive_capture_at',(SELECT MIN(captured_at) FROM public.revenue_booking_activity_archive
       WHERE hotel_id=p_hotel_id)
  ) INTO response;
  RETURN response;
END;
$fn$;
REVOKE ALL ON FUNCTION public.revenue_booking_insights_v2(text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revenue_booking_insights_v2(text,integer) TO authenticated;
