-- 1) Server-side scheduler claim: global single-flight, oldest property first.
CREATE OR REPLACE FUNCTION public.claim_next_revenue_sync(
  _fresh_for interval DEFAULT '30 minutes'::interval,
  _lease_for interval DEFAULT '10 minutes'::interval
)
RETURNS TABLE(hotel_id text, organization_slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hotel text;
  v_org text;
BEGIN
  -- Seed state rows for every active Previo-connected property.
  INSERT INTO public.revenue_sync_state (hotel_id, organization_slug)
  SELECT hc.hotel_id, o.slug
  FROM public.hotel_configurations hc
  JOIN public.organizations o ON o.id = hc.organization_id
  WHERE COALESCE(hc.is_active, true)
    AND public.hotel_has_active_previo(hc.hotel_id)
  ON CONFLICT (hotel_id) DO NOTHING;

  -- Global single-flight: if any property is being refreshed, wait.
  PERFORM 1 FROM public.revenue_sync_state
   WHERE lease_expires_at IS NOT NULL AND lease_expires_at > now()
   LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  SELECT s.hotel_id, s.organization_slug
    INTO v_hotel, v_org
  FROM public.revenue_sync_state s
  WHERE public.hotel_has_active_previo(s.hotel_id)
    AND (s.last_success_at IS NULL OR s.last_success_at < now() - _fresh_for)
  ORDER BY s.last_success_at ASC NULLS FIRST
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_hotel IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.revenue_sync_state
     SET lease_started_at = now(),
         lease_expires_at = now() + _lease_for,
         lease_owner = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE public.revenue_sync_state.hotel_id = v_hotel;

  RETURN QUERY SELECT v_hotel, v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_revenue_sync(interval, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_revenue_sync(interval, interval) TO service_role;

-- 2) What the user may be told while a refresh is queued.
CREATE OR REPLACE FUNCTION public.revenue_sync_wait_state(_hotel_id text)
RETURNS TABLE(scope text, last_success_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_this boolean;
  v_other boolean;
  v_last timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_access_hotel(auth.uid(), _hotel_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT s.last_success_at,
         (s.lease_expires_at IS NOT NULL AND s.lease_expires_at > now())
    INTO v_last, v_this
  FROM public.revenue_sync_state s
  WHERE s.hotel_id = _hotel_id;

  SELECT EXISTS (
    SELECT 1 FROM public.revenue_sync_state s
    WHERE s.hotel_id <> _hotel_id
      AND s.lease_expires_at IS NOT NULL
      AND s.lease_expires_at > now()
  ) INTO v_other;

  RETURN QUERY SELECT
    CASE WHEN COALESCE(v_this, false) THEN 'this_property'
         WHEN COALESCE(v_other, false) THEN 'other'
         ELSE 'idle' END,
    v_last;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revenue_sync_wait_state(text) TO authenticated;