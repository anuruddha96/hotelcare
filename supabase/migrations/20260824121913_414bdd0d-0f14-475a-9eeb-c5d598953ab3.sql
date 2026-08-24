
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
      AND s.captured_at < ((_window_start::timestamp AT TIME ZONE 'Europe/Budapest'))
    ORDER BY s.stay_date, s.captured_at DESC
  )
  SELECT * FROM latest
  UNION
  SELECT * FROM baseline;
$$;
