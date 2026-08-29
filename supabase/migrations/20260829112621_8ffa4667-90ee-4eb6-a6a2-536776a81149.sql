CREATE OR REPLACE FUNCTION public.revenue_trim_by_stay_date(_arr jsonb, _cutoff text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(e)
     FROM jsonb_array_elements(COALESCE(_arr, '[]'::jsonb)) e
     WHERE COALESCE(e->>'stay_date', '') <= _cutoff),
    '[]'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.get_revenue_published_payload_window(_hotel_id text, _horizon_days integer DEFAULT 120)
RETURNS TABLE (
  sync_completed_at timestamptz,
  sync_completed_by_name text,
  horizon_from date,
  horizon_to date,
  payload jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH src AS (
    SELECT p.*
    FROM public.revenue_published_payloads p
    WHERE p.hotel_id = _hotel_id
      AND public.user_can_access_hotel(auth.uid(), p.hotel_id)
  ),
  cut AS (
    SELECT (((now() AT TIME ZONE 'Europe/Budapest')::date) + GREATEST(COALESCE(_horizon_days, 120), 1))::date AS d
  )
  SELECT
    s.sync_completed_at,
    s.sync_completed_by_name,
    s.horizon_from,
    LEAST(s.horizon_to, (SELECT d FROM cut)) AS horizon_to,
    s.payload
      || jsonb_build_object(
        'nights',        public.revenue_trim_by_stay_date(s.payload->'nights',        (SELECT d::text FROM cut)),
        'snapshots',     public.revenue_trim_by_stay_date(s.payload->'snapshots',     (SELECT d::text FROM cut)),
        'rates',         public.revenue_trim_by_stay_date(s.payload->'rates',         (SELECT d::text FROM cut)),
        'cancellations', public.revenue_trim_by_stay_date(s.payload->'cancellations', (SELECT d::text FROM cut)),
        'movements',     public.revenue_trim_by_stay_date(s.payload->'movements',     (SELECT d::text FROM cut)),
        'soldOutPrices', public.revenue_trim_by_stay_date(s.payload->'soldOutPrices', (SELECT d::text FROM cut))
      ) AS payload
  FROM src s
$$;

REVOKE ALL ON FUNCTION public.get_revenue_published_payload_window(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_published_payload_window(text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.revenue_trim_by_stay_date(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revenue_trim_by_stay_date(jsonb, text) TO authenticated, service_role;