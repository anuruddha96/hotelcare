
CREATE OR REPLACE FUNCTION public.revenue_calendar_snapshots(
  _hotel_id text,
  _from date,
  _to date,
  _window_start date
)
RETURNS TABLE (
  stay_date date,
  captured_date date,
  captured_at timestamptz,
  rooms_sold integer,
  rooms_available integer,
  occupancy_pct numeric,
  revenue_eur numeric,
  adr_eur numeric,
  new_bookings integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (s.stay_date)
      s.stay_date, s.captured_date, s.captured_at, s.rooms_sold, s.rooms_available,
      s.occupancy_pct, s.revenue_eur, s.adr_eur, s.new_bookings
    FROM public.revenue_daily_snapshots s
    WHERE s.hotel_id = _hotel_id
      AND s.stay_date BETWEEN _from AND _to
    ORDER BY s.stay_date, s.captured_at DESC
  ),
  baseline AS (
    SELECT DISTINCT ON (s.stay_date)
      s.stay_date, s.captured_date, s.captured_at, s.rooms_sold, s.rooms_available,
      s.occupancy_pct, s.revenue_eur, s.adr_eur, s.new_bookings
    FROM public.revenue_daily_snapshots s
    WHERE s.hotel_id = _hotel_id
      AND s.stay_date BETWEEN _from AND _to
      AND s.captured_at < (_window_start::timestamptz)
    ORDER BY s.stay_date, s.captured_at DESC
  )
  SELECT * FROM latest
  UNION
  SELECT * FROM baseline;
$$;

CREATE OR REPLACE FUNCTION public.revenue_pickup_movements(
  _hotel_id text,
  _from date,
  _to date,
  _since timestamptz
)
RETURNS TABLE (
  stay_date date,
  delta integer,
  captured_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.stay_date,
    SUM(p.delta)::integer AS delta,
    MAX(p.captured_at) AS captured_at
  FROM public.pickup_snapshots p
  WHERE p.hotel_id = _hotel_id
    AND p.source = 'previo_sync_diff'
    AND p.stay_date BETWEEN _from AND _to
    AND p.captured_at >= _since
    AND p.delta <> 0
  GROUP BY p.stay_date, date_trunc('hour', p.captured_at), (p.delta > 0)
  HAVING SUM(p.delta) <> 0;
$$;

GRANT EXECUTE ON FUNCTION public.revenue_calendar_snapshots(text, date, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revenue_pickup_movements(text, date, date, timestamptz) TO authenticated;
