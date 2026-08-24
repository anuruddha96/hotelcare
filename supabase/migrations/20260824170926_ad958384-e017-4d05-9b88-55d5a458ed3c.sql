CREATE OR REPLACE FUNCTION public.get_revenue_published_payload(_hotel_id text)
RETURNS TABLE (
  sync_completed_at timestamptz,
  sync_completed_by_name text,
  horizon_from date,
  horizon_to date,
  payload jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.user_can_access_hotel(auth.uid(), _hotel_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.sync_completed_at, p.sync_completed_by_name, p.horizon_from, p.horizon_to, p.payload
  FROM public.revenue_published_payloads p
  WHERE p.hotel_id = _hotel_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_revenue_published_payload(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_published_payload(text) TO authenticated, service_role;