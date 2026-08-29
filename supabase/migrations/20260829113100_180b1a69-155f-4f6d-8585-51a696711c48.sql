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
SET search_path TO 'public'
AS $$
  WITH cut AS (
    SELECT (((now() AT TIME ZONE 'Europe/Budapest')::date) + GREATEST(COALESCE(_horizon_days, 120), 1))::date AS d
  )
  SELECT
    p.sync_completed_at,
    p.sync_completed_by_name,
    p.horizon_from,
    LEAST(p.horizon_to, (SELECT d FROM cut)) AS horizon_to,
    p.payload
      || jsonb_build_object(
        'nights',        public.revenue_trim_by_stay_date(p.payload->'nights',        (SELECT d::text FROM cut)),
        'snapshots',     public.revenue_trim_by_stay_date(p.payload->'snapshots',     (SELECT d::text FROM cut)),
        'rates',         public.revenue_trim_by_stay_date(p.payload->'rates',         (SELECT d::text FROM cut)),
        'cancellations', public.revenue_trim_by_stay_date(p.payload->'cancellations', (SELECT d::text FROM cut)),
        'movements',     public.revenue_trim_by_stay_date(p.payload->'movements',     (SELECT d::text FROM cut)),
        'soldOutPrices', public.revenue_trim_by_stay_date(p.payload->'soldOutPrices', (SELECT d::text FROM cut))
      ) AS payload
  FROM public.revenue_published_payloads p
  WHERE p.hotel_id = _hotel_id
    AND public.user_can_access_hotel(auth.uid(), p.hotel_id)
    AND EXISTS (
      SELECT 1
      FROM public.profiles profile
      WHERE profile.id = auth.uid()
        AND (
          COALESCE(profile.is_super_admin, false)
          OR profile.organization_slug = p.organization_slug
        )
    )
$$;

REVOKE ALL ON FUNCTION public.get_revenue_published_payload_window(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_published_payload_window(text, integer) TO authenticated, service_role;