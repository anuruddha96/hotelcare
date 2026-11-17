-- Allow operating staff to temporarily work in any ACTIVE hotel belonging to
-- their own organization. The server, not a client-supplied slug, decides scope.
-- The normal/home venue is snapshotted once and never overwritten by switching.

CREATE TABLE IF NOT EXISTS public.staff_work_venue_state (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_slug text NOT NULL,
  home_hotel text NOT NULL,
  last_worked_hotel text NOT NULL,
  last_switched_on date,
  prompt_next_day boolean NOT NULL DEFAULT false,
  last_confirmed_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_work_venue_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_work_venue_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_work_venue_state TO authenticated;

DROP POLICY IF EXISTS "Workers read only their own venue state" ON public.staff_work_venue_state;
CREATE POLICY "Workers read only their own venue state"
ON public.staff_work_venue_state FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.staff_select_work_hotel(
  p_hotel_id text, p_confirm boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_state public.staff_work_venue_state%ROWTYPE;
  v_selected text;
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_changed boolean;
  v_home text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in before selecting a hotel' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_user FROM public.profiles
  WHERE id = auth.uid() AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_user.role::text NOT IN ('maintenance','maintenance_manager','housekeeping') THEN
    RAISE EXCEPTION 'This hotel picker is only available to operational staff' USING ERRCODE = '42501';
  END IF;

  -- Canonical hotel ID, active hotel, active organization and CURRENT user membership.
  SELECT h.hotel_id INTO v_selected
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE h.hotel_id = p_hotel_id
    AND h.is_active IS TRUE AND o.is_active IS TRUE
    AND o.slug = v_user.organization_slug
  LIMIT 1;

  IF v_selected IS NULL THEN
    RAISE EXCEPTION 'The requested hotel is outside your organization or inactive'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_state FROM public.staff_work_venue_state
  WHERE user_id = v_user.id FOR UPDATE;

  v_home := COALESCE(v_state.home_hotel, v_user.assigned_hotel, v_selected);
  v_changed := public.get_hotel_name_from_id(v_user.assigned_hotel)
    IS DISTINCT FROM public.get_hotel_name_from_id(v_selected);

  -- A confirmation of yesterday's hotel clears the next-day prompt.
  -- Selecting a DIFFERENT hotel starts a new one-day cycle, even at confirmation.
  INSERT INTO public.staff_work_venue_state
    (user_id, organization_slug, home_hotel, last_worked_hotel,
     last_switched_on, prompt_next_day, last_confirmed_on, updated_at)
  VALUES
    (v_user.id, v_user.organization_slug, v_home, v_selected,
     CASE WHEN v_changed THEN v_today ELSE v_state.last_switched_on END,
     CASE WHEN v_changed THEN
       public.get_hotel_name_from_id(v_selected) IS DISTINCT FROM
         public.get_hotel_name_from_id(v_home)
     WHEN p_confirm THEN false ELSE COALESCE(v_state.prompt_next_day, false) END,
     CASE WHEN p_confirm THEN v_today ELSE v_state.last_confirmed_on END,
     now())
  ON CONFLICT (user_id) DO UPDATE SET
    organization_slug = EXCLUDED.organization_slug,
    home_hotel = staff_work_venue_state.home_hotel,
    last_worked_hotel = EXCLUDED.last_worked_hotel,
    last_switched_on = EXCLUDED.last_switched_on,
    prompt_next_day = EXCLUDED.prompt_next_day,
    last_confirmed_on = EXCLUDED.last_confirmed_on,
    updated_at = now();

  IF v_user.assigned_hotel IS DISTINCT FROM v_selected THEN
    UPDATE public.profiles SET assigned_hotel = v_selected WHERE id = v_user.id;
  END IF;

  RETURN v_selected;
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_select_work_hotel(text,boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_select_work_hotel(text,boolean)
  TO authenticated;

-- profiles_update_own grants self-service updates; it must not permit workers
-- to bypass the controlled picker by editing assigned_hotel or organization_slug.
-- Other staff profile fields (photo, phone, language) remain editable.
CREATE OR REPLACE FUNCTION public.guard_staff_profile_tenant()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;

  IF v_actor = OLD.id AND NOT public.is_super_admin(v_actor) THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
       OR (OLD.role::text <> 'admin'
           AND NEW.organization_slug IS DISTINCT FROM OLD.organization_slug) THEN
      RAISE EXCEPTION 'You may not change your own access or organization'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.role::text IN ('maintenance','maintenance_manager','housekeeping')
       AND NEW.assigned_hotel IS DISTINCT FROM OLD.assigned_hotel
       AND current_user = 'authenticated' THEN
      RAISE EXCEPTION 'Use the authorized work hotel picker'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Even manager-initiated assignments must refer to an active hotel
  -- belonging to the recipient's organization; super admins retain transfer rights.
  IF NEW.assigned_hotel IS DISTINCT FROM OLD.assigned_hotel
     AND NEW.assigned_hotel IS NOT NULL
     AND NOT public.is_super_admin(v_actor)
     AND NOT EXISTS (
       SELECT 1 FROM public.hotel_configurations h
       JOIN public.organizations o ON o.id = h.organization_id
       WHERE o.slug = NEW.organization_slug
         AND h.is_active AND o.is_active
         AND (h.hotel_id = NEW.assigned_hotel OR h.hotel_name = NEW.assigned_hotel)
     ) THEN
    RAISE EXCEPTION 'Hotel does not belong to the selected organization'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_staff_profile_tenant_update ON public.profiles;
CREATE TRIGGER guard_staff_profile_tenant_update
BEFORE UPDATE ON public.profiles FOR EACH ROW
EXECUTE FUNCTION public.guard_staff_profile_tenant();

-- Maintenance supervisors need the same property-scoped workflow already
-- available to maintenance workers, without access to unrelated departments.
INSERT INTO public.department_access_config (role, department, access_scope, can_manage_all)
VALUES ('maintenance_manager'::public.user_role, 'maintenance', 'hotel_only', false)
ON CONFLICT (role, department) DO NOTHING;

COMMENT ON TABLE public.staff_work_venue_state IS
  'Per-worker home venue and next-day selection state. Written only by validated RPC.';
