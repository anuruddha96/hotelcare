-- Monthly KPI cards must not wait for the rate calendar's lazy 30-day window.
-- Aggregate the SAME atomically published Previo booking-night payload as the
-- calendar; do not use independently timed snapshots or historical forecasts.
CREATE OR REPLACE FUNCTION public.get_revenue_monthly_kpis(_hotel_id text)
RETURNS TABLE (
  month_key text,
  days integer,
  rooms_sold bigint,
  revenue_eur numeric,
  sync_completed_at timestamptz,
  complete boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH authorized AS (
    SELECT p.payload, p.horizon_from, p.horizon_to, p.sync_completed_at
    FROM public.revenue_published_payloads p
    WHERE p.hotel_id = _hotel_id
      AND public.user_can_access_hotel(auth.uid(), p.hotel_id)
      AND EXISTS (
        SELECT 1 FROM public.profiles profile
        WHERE profile.id = auth.uid()
          AND (COALESCE(profile.is_super_admin, false)
               OR profile.organization_slug = p.organization_slug)
      )
  ),
  bounds AS (
    SELECT (now() AT TIME ZONE 'Europe/Budapest')::date AS today
  ),
  months AS (
    SELECT (date_trunc('month', b.today::timestamp) + make_interval(months => g.n))::date AS month_start,
           b.today
    FROM bounds b CROSS JOIN generate_series(0, 5) AS g(n)
  ),
  night_totals AS (
    SELECT date_trunc('month', (n.item->>'stay_date')::date)::date AS month_start,
           count(*)::bigint AS sold,
           sum(COALESCE((n.item->>'nightly_price_eur')::numeric, 0)) AS revenue
    FROM authorized p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.payload->'nights', '[]'::jsonb)) AS n(item)
    CROSS JOIN bounds b
    WHERE (n.item->>'stay_date')::date >= b.today
      AND (n.item->>'stay_date')::date < (date_trunc('month', b.today::timestamp) + interval '6 months')::date
    GROUP BY 1
  )
  SELECT to_char(m.month_start, 'YYYY-MM') AS month_key,
         ((m.month_start + interval '1 month')::date - GREATEST(m.month_start, m.today))::integer AS days,
         COALESCE(n.sold, 0) AS rooms_sold,
         COALESCE(n.revenue, 0) AS revenue_eur,
         p.sync_completed_at,
         (p.sync_completed_at IS NOT NULL
          AND p.horizon_from <= GREATEST(m.month_start, m.today)
          AND p.horizon_to >= (m.month_start + interval '1 month')::date - 1) AS complete
  FROM authorized p
  CROSS JOIN months m
  LEFT JOIN night_totals n ON n.month_start = m.month_start
  ORDER BY m.month_start;
$function$;

REVOKE ALL ON FUNCTION public.get_revenue_monthly_kpis(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_revenue_monthly_kpis(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_monthly_kpis(text) TO authenticated;

COMMENT ON FUNCTION public.get_revenue_monthly_kpis(text) IS
  'Six compact, Budapest-local monthly KPI totals from one authorized, completed Previo revenue publication; the caller must calculate capacity from its verified sellable-room inventory.';
