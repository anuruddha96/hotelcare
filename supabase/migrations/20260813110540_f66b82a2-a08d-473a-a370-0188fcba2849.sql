CREATE TABLE public.staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  shift_start time NOT NULL DEFAULT time '09:00',
  shift_end time NOT NULL DEFAULT time '17:00',
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  published_at timestamptz,
  published_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_schedules_status_valid CHECK (status IN ('draft','published','off')),
  CONSTRAINT staff_schedules_shift_valid CHECK (shift_end > shift_start),
  CONSTRAINT staff_schedules_unique_employee_day UNIQUE (organization_slug, hotel_id, user_id, work_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedules TO authenticated;
GRANT ALL ON public.staff_schedules TO service_role;
ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.staff_schedule_venues (
  schedule_id uuid NOT NULL REFERENCES public.staff_schedules(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_id, venue_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedule_venues TO authenticated;
GRANT ALL ON public.staff_schedule_venues TO service_role;
ALTER TABLE public.staff_schedule_venues ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_slnt_schedule(_hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.organization_slug IN ('slnt','slnt-group')
      AND p.role::text IN ('admin','top_management','top_management_manager','manager','housekeeping_manager','supervisor','hr')
      AND public.user_can_access_hotel(p.id, _hotel_id)
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_slnt_schedule(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_slnt_schedule(text) TO authenticated, service_role;

CREATE POLICY "SLNT staff view own published schedules"
ON public.staff_schedules FOR SELECT TO authenticated
USING (user_id = auth.uid() AND status = 'published' AND organization_slug IN ('slnt','slnt-group'));

CREATE POLICY "SLNT schedule managers view accessible schedules"
ON public.staff_schedules FOR SELECT TO authenticated
USING (public.can_manage_slnt_schedule(hotel_id));

CREATE POLICY "SLNT schedule managers create accessible schedules"
ON public.staff_schedules FOR INSERT TO authenticated
WITH CHECK (
  organization_slug IN ('slnt','slnt-group')
  AND created_by = auth.uid()
  AND public.can_manage_slnt_schedule(hotel_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles employee
    WHERE employee.id = user_id
      AND employee.organization_slug = staff_schedules.organization_slug
  )
);

CREATE POLICY "SLNT schedule managers update accessible schedules"
ON public.staff_schedules FOR UPDATE TO authenticated
USING (public.can_manage_slnt_schedule(hotel_id))
WITH CHECK (
  organization_slug IN ('slnt','slnt-group')
  AND public.can_manage_slnt_schedule(hotel_id)
  AND EXISTS (
    SELECT 1 FROM public.profiles employee
    WHERE employee.id = user_id
      AND employee.organization_slug = staff_schedules.organization_slug
  )
);

CREATE POLICY "SLNT schedule managers delete accessible schedules"
ON public.staff_schedules FOR DELETE TO authenticated
USING (public.can_manage_slnt_schedule(hotel_id));

CREATE POLICY "SLNT staff view venues for own published shifts"
ON public.staff_schedule_venues FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.staff_schedules s
  WHERE s.id = schedule_id AND s.user_id = auth.uid() AND s.status = 'published'
));

CREATE POLICY "SLNT schedule managers view shift venues"
ON public.staff_schedule_venues FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.staff_schedules s
  WHERE s.id = schedule_id AND public.can_manage_slnt_schedule(s.hotel_id)
));

CREATE POLICY "SLNT schedule managers create shift venues"
ON public.staff_schedule_venues FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.staff_schedules s
  JOIN public.venues v ON v.id = venue_id
  WHERE s.id = schedule_id
    AND public.can_manage_slnt_schedule(s.hotel_id)
    AND v.organization_slug = s.organization_slug
    AND v.hotel_id = s.hotel_id
));

CREATE POLICY "SLNT schedule managers update shift venues"
ON public.staff_schedule_venues FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.staff_schedules s
  WHERE s.id = schedule_id AND public.can_manage_slnt_schedule(s.hotel_id)
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM public.staff_schedules s
  JOIN public.venues v ON v.id = venue_id
  WHERE s.id = schedule_id
    AND public.can_manage_slnt_schedule(s.hotel_id)
    AND v.organization_slug = s.organization_slug
    AND v.hotel_id = s.hotel_id
));

CREATE POLICY "SLNT schedule managers delete shift venues"
ON public.staff_schedule_venues FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.staff_schedules s
  WHERE s.id = schedule_id AND public.can_manage_slnt_schedule(s.hotel_id)
));

CREATE INDEX staff_schedules_org_hotel_date_idx ON public.staff_schedules (organization_slug, hotel_id, work_date);
CREATE INDEX staff_schedules_user_date_idx ON public.staff_schedules (user_id, work_date);
CREATE INDEX staff_schedule_venues_venue_idx ON public.staff_schedule_venues (venue_id);

CREATE TRIGGER touch_staff_schedules_updated_at
BEFORE UPDATE ON public.staff_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.revenue_sync_state
  ADD COLUMN last_success_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN last_success_by_name text;

CREATE OR REPLACE FUNCTION public.claim_revenue_sync(
  _hotel_id text,
  _fresh_for interval DEFAULT interval '30 minutes',
  _lease_for interval DEFAULT interval '10 minutes',
  _force boolean DEFAULT false
)
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
$$;

CREATE OR REPLACE FUNCTION public.complete_revenue_sync(
  _hotel_id text,
  _success boolean,
  _actor_id uuid,
  _actor_name text DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.revenue_sync_state
  SET last_success_at = CASE WHEN _success THEN now() ELSE last_success_at END,
      last_success_by = CASE WHEN _success THEN _actor_id ELSE last_success_by END,
      last_success_by_name = CASE WHEN _success THEN NULLIF(left(COALESCE(_actor_name, ''), 200), '') ELSE last_success_by_name END,
      lease_started_at = NULL,
      lease_expires_at = NULL,
      lease_owner = NULL,
      last_error = CASE WHEN _success THEN NULL ELSE left(COALESCE(_error, 'Revenue refresh failed'), 1000) END,
      updated_at = now()
  WHERE hotel_id = _hotel_id
    AND lease_owner = _actor_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_revenue_sync(text, interval, interval, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_revenue_sync(text, interval, interval, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_revenue_sync(text, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_revenue_sync(text, boolean, uuid, text, text) TO service_role;