CREATE TABLE public.revenue_sync_state (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  last_success_at timestamptz,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  lease_owner uuid,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.revenue_sync_state TO authenticated;
GRANT ALL ON public.revenue_sync_state TO service_role;
ALTER TABLE public.revenue_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view revenue sync state for accessible hotels"
ON public.revenue_sync_state FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE OR REPLACE FUNCTION public.user_can_access_hotel(_uid uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.hotel_configurations hc
      ON hc.hotel_id = _hotel_id
      OR hc.hotel_name = _hotel_id
      OR public.get_hotel_name_from_id(hc.hotel_id) = _hotel_id
    LEFT JOIN public.organizations o ON o.id = hc.organization_id
    WHERE p.id = _uid
      AND (
        COALESCE(p.is_super_admin, false)
        OR (
          p.organization_slug = o.slug
          AND (
            p.role IN ('admin','top_management','top_management_manager')
            OR p.assigned_hotel = hc.hotel_id
            OR p.assigned_hotel = hc.hotel_name
            OR public.get_hotel_name_from_id(p.assigned_hotel) = hc.hotel_name
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "Authenticated users can view hotel configurations" ON public.hotel_configurations;
CREATE POLICY "Users view hotel configurations in their organization"
ON public.hotel_configurations FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = hotel_configurations.organization_id
      AND o.slug = public.get_user_organization_slug(auth.uid())
  )
);

DROP POLICY IF EXISTS "Admins and managers can view sync history" ON public.pms_sync_history;
CREATE POLICY "Users view sync history for accessible hotels"
ON public.pms_sync_history FOR SELECT TO authenticated
USING (hotel_id IS NOT NULL AND public.user_can_access_hotel(auth.uid(), hotel_id));

DROP POLICY IF EXISTS "Admins can view all PMS configurations" ON public.pms_configurations;
DROP POLICY IF EXISTS "Hotel managers can view their PMS configuration" ON public.pms_configurations;
CREATE POLICY "Users view accessible PMS configurations"
ON public.pms_configurations FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE OR REPLACE FUNCTION public.claim_revenue_sync(_hotel_id text, _fresh_for interval DEFAULT interval '30 minutes', _lease_for interval DEFAULT interval '10 minutes')
RETURNS TABLE(status text, last_success_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
REVOKE ALL ON FUNCTION public.claim_revenue_sync(text, interval, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_revenue_sync(text, interval, interval) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_revenue_sync(_hotel_id text, _success boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.revenue_sync_state
  SET last_success_at = CASE WHEN _success THEN now() ELSE last_success_at END,
      lease_started_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      last_error = CASE WHEN _success THEN NULL ELSE left(COALESCE(_error, 'Revenue refresh failed'), 1000) END,
      updated_at = now()
  WHERE hotel_id = _hotel_id;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_revenue_sync(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_revenue_sync(text, boolean, text) TO service_role;