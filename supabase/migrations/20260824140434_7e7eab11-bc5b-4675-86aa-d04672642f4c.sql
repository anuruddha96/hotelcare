CREATE OR REPLACE FUNCTION public.billing_realised_revenue(
  _hotel_id text,
  _from date,
  _to date
)
RETURNS TABLE (revenue_eur numeric, room_nights integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH nights AS (
    SELECT DISTINCT ON (res_id, room_key, stay_date)
      stay_date,
      COALESCE(nightly_price_eur, 0) AS price
    FROM public.revenue_booking_nights
    WHERE hotel_id = _hotel_id
      AND stay_date >= _from
      AND stay_date < _to
      AND COALESCE(status_id, 0) NOT IN (5, 6)
    ORDER BY res_id, room_key, stay_date, captured_at DESC
  )
  SELECT COALESCE(SUM(price), 0)::numeric AS revenue_eur,
         COUNT(*)::int AS room_nights
  FROM nights;
$$;

REVOKE ALL ON FUNCTION public.billing_realised_revenue(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_realised_revenue(text, date, date) TO service_role;
