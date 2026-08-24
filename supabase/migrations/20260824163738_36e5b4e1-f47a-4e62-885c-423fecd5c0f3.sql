DROP FUNCTION IF EXISTS public.claim_next_revenue_sync(interval, interval);

CREATE OR REPLACE FUNCTION public.claim_next_revenue_sync(
  _fresh_for interval DEFAULT '00:30:00'::interval,
  _lease_for interval DEFAULT '00:10:00'::interval
)
RETURNS TABLE(out_hotel_id text, out_organization_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hotel text;
  v_org text;
BEGIN
  -- Seed state rows for every active Previo-connected property.
  INSERT INTO public.revenue_sync_state AS s (hotel_id, organization_slug)
  SELECT hc.hotel_id, o.slug
  FROM public.hotel_configurations hc
  JOIN public.organizations o ON o.id = hc.organization_id
  WHERE COALESCE(hc.is_active, true)
    AND public.hotel_has_active_previo(hc.hotel_id)
  ON CONFLICT (hotel_id) DO NOTHING;

  -- Global single-flight: if any property is being refreshed, wait.
  PERFORM 1 FROM public.revenue_sync_state st
   WHERE st.lease_expires_at IS NOT NULL AND st.lease_expires_at > now()
   LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  SELECT s2.hotel_id, s2.organization_slug
    INTO v_hotel, v_org
  FROM public.revenue_sync_state s2
  WHERE public.hotel_has_active_previo(s2.hotel_id)
    AND (s2.last_success_at IS NULL OR s2.last_success_at < now() - _fresh_for)
  ORDER BY s2.last_success_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_hotel IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.revenue_sync_state s3
     SET lease_started_at = now(),
         lease_expires_at = now() + _lease_for,
         lease_owner = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE s3.hotel_id = v_hotel;

  RETURN QUERY SELECT v_hotel, v_org;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_next_revenue_sync(interval, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_revenue_sync(interval, interval) TO service_role;