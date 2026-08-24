CREATE OR REPLACE FUNCTION public.get_revenue_published_payload(_hotel_id text)
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
  SELECT p.sync_completed_at, p.sync_completed_by_name, p.horizon_from, p.horizon_to, p.payload
  FROM public.revenue_published_payloads p
  WHERE p.hotel_id = _hotel_id
    AND public.user_can_access_hotel(auth.uid(), p.hotel_id)
$$;

REVOKE ALL ON FUNCTION public.get_revenue_published_payload(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_published_payload(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.user_can_access_hotel(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_access_hotel(uuid,text) TO authenticated, service_role;