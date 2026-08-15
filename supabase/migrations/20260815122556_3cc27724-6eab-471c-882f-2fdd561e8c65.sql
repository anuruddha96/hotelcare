UPDATE public.revenue_sync_state
SET lease_owner = NULL, lease_started_at = NULL, lease_expires_at = NULL, updated_at = now()
WHERE lease_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_revenue_sync(_hotel_id text, _fresh_for interval DEFAULT '00:30:00'::interval, _lease_for interval DEFAULT '00:03:00'::interval)
 RETURNS TABLE(status text, last_success_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_state public.revenue_sync_state%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_access_hotel(auth.uid(), _hotel_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT o.slug INTO v_org
  FROM public.hotel_configurations hc
  JOIN public.organizations o ON o.id = hc.organization_id
  WHERE hc.hotel_id = _hotel_id AND COALESCE(hc.is_active, true)
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Unknown or inactive hotel' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.revenue_sync_state (hotel_id, organization_slug)
  VALUES (_hotel_id, v_org)
  ON CONFLICT (hotel_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.revenue_sync_state
  WHERE hotel_id = _hotel_id
  FOR UPDATE;

  IF v_state.last_success_at IS NOT NULL AND v_state.last_success_at >= now() - _fresh_for THEN
    RETURN QUERY SELECT 'fresh'::text, v_state.last_success_at;
    RETURN;
  END IF;

  IF v_state.lease_expires_at IS NOT NULL AND v_state.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'already_running'::text, v_state.last_success_at;
    RETURN;
  END IF;

  UPDATE public.revenue_sync_state
  SET lease_started_at = now(),
      lease_expires_at = now() + _lease_for,
      lease_owner = auth.uid(),
      last_error = NULL,
      updated_at = now()
  WHERE hotel_id = _hotel_id;

  RETURN QUERY SELECT 'claimed'::text, v_state.last_success_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_revenue_sync(_hotel_id text, _fresh_for interval DEFAULT '00:30:00'::interval, _lease_for interval DEFAULT '00:03:00'::interval, _force boolean DEFAULT false)
 RETURNS TABLE(status text, last_success_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org text;
  v_state public.revenue_sync_state%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_access_hotel(auth.uid(), _hotel_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT o.slug INTO v_org
  FROM public.hotel_configurations hc
  JOIN public.organizations o ON o.id = hc.organization_id
  WHERE hc.hotel_id = _hotel_id AND COALESCE(hc.is_active, true)
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Unknown or inactive hotel' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.revenue_sync_state (hotel_id, organization_slug)
  VALUES (_hotel_id, v_org)
  ON CONFLICT (hotel_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.revenue_sync_state
  WHERE hotel_id = _hotel_id
  FOR UPDATE;

  IF v_state.lease_expires_at IS NOT NULL AND v_state.lease_expires_at > now() THEN
    RETURN QUERY SELECT 'already_running'::text, v_state.last_success_at;
    RETURN;
  END IF;

  IF NOT _force AND v_state.last_success_at IS NOT NULL AND v_state.last_success_at >= now() - _fresh_for THEN
    RETURN QUERY SELECT 'fresh'::text, v_state.last_success_at;
    RETURN;
  END IF;

  UPDATE public.revenue_sync_state
  SET lease_started_at = now(),
      lease_expires_at = now() + _lease_for,
      lease_owner = auth.uid(),
      last_error = NULL,
      updated_at = now()
  WHERE hotel_id = _hotel_id;

  RETURN QUERY SELECT 'claimed'::text, v_state.last_success_at;
END;
$function$;