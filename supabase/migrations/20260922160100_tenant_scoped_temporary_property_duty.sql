-- #346: location choice never changes a user's permanent assigned_hotel.
-- No role (including managers) gets automatic cross-property membership.
-- An organization administrator explicitly grants each destination property;
-- normal clients have no INSERT/UPDATE/DELETE rights on either table.
CREATE TABLE IF NOT EXISTS public.property_duty_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  hotel_configuration_id uuid NOT NULL REFERENCES public.hotel_configurations(id),
  can_manage boolean NOT NULL DEFAULT false,
  granted_by uuid NOT NULL REFERENCES public.profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES public.profiles(id),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS property_duty_grant_active_unique
  ON public.property_duty_grants(user_id, hotel_configuration_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS property_duty_grant_active_hotel
  ON public.property_duty_grants(hotel_configuration_id, user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.property_duty_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  hotel_configuration_id uuid NOT NULL REFERENCES public.hotel_configurations(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 hours'),
  ended_at timestamptz,
  started_by uuid NOT NULL REFERENCES public.profiles(id),
  ended_by uuid REFERENCES public.profiles(id),
  source text NOT NULL DEFAULT 'user_choice',
  CONSTRAINT property_duty_expiry_after_start CHECK (expires_at > started_at),
  CONSTRAINT property_duty_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS property_duty_one_open_session
  ON public.property_duty_sessions(user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS property_duty_active_hotel
  ON public.property_duty_sessions(organization_id, hotel_configuration_id, expires_at)
  WHERE ended_at IS NULL;

ALTER TABLE public.property_duty_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_duty_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_duty_grants, public.property_duty_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.property_duty_grants, public.property_duty_sessions TO authenticated;
DROP POLICY IF EXISTS property_duty_grants_read_own ON public.property_duty_grants;
CREATE POLICY property_duty_grants_read_own ON public.property_duty_grants
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.profiles p JOIN public.organizations o ON o.slug = p.organization_slug
      WHERE p.id = auth.uid() AND p.deleted_at IS NULL AND o.id = property_duty_grants.organization_id
    )
  );
DROP POLICY IF EXISTS property_duty_sessions_read_own ON public.property_duty_sessions;
CREATE POLICY property_duty_sessions_read_own ON public.property_duty_sessions
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.profiles p JOIN public.organizations o ON o.slug = p.organization_slug
      WHERE p.id = auth.uid() AND p.deleted_at IS NULL AND o.id = property_duty_sessions.organization_id
    )
  );

-- All entitlement mutations validate the caller, target employee and hotel
-- against one and the same active organization. Housekeepers cannot be granted.
CREATE OR REPLACE FUNCTION public.grant_property_duty(
  _user_id uuid, _hotel_configuration_id uuid, _can_manage boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  caller public.profiles%rowtype;
  employee public.profiles%rowtype;
  destination public.hotel_configurations%rowtype;
  org_id uuid;
BEGIN
  SELECT * INTO caller FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF caller.id IS NULL OR caller.organization_slug IS NULL OR
     caller.role::text NOT IN ('admin', 'top_management', 'top_management_manager') THEN
    RAISE EXCEPTION 'Not authorized to grant duty' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO org_id FROM public.organizations
    WHERE slug = caller.organization_slug AND is_active = true;
  SELECT * INTO employee FROM public.profiles
    WHERE id = _user_id AND organization_slug = caller.organization_slug AND deleted_at IS NULL FOR UPDATE;
  SELECT * INTO destination FROM public.hotel_configurations
    WHERE id = _hotel_configuration_id AND organization_id = org_id AND is_active = true;
  IF org_id IS NULL OR employee.id IS NULL OR destination.id IS NULL OR
     employee.role::text NOT IN (
       'maintenance', 'maintenance_manager', 'reception', 'reception_manager',
       'front_office', 'manager', 'admin', 'top_management', 'top_management_manager'
     ) THEN
    RAISE EXCEPTION 'Employee or destination is not eligible in this organization' USING ERRCODE = '42501';
  END IF;
  IF _can_manage AND employee.role::text NOT IN
     ('manager','admin','top_management','top_management_manager','maintenance_manager','reception_manager') THEN
    RAISE EXCEPTION 'Management delegation requires an existing manager role' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.property_duty_grants
    (user_id, organization_id, hotel_configuration_id, can_manage, granted_by)
  VALUES (employee.id, org_id, destination.id, _can_manage, caller.id)
  ON CONFLICT (user_id, hotel_configuration_id) WHERE revoked_at IS NULL
  DO UPDATE SET can_manage = EXCLUDED.can_manage,
                granted_by = EXCLUDED.granted_by, granted_at = now();
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.revoke_property_duty(
  _user_id uuid, _hotel_configuration_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  caller public.profiles%rowtype;
  employee public.profiles%rowtype;
  org_id uuid;
  changed integer;
BEGIN
  SELECT * INTO caller FROM public.profiles WHERE id = auth.uid() AND deleted_at IS NULL;
  IF caller.id IS NULL OR caller.role::text NOT IN
     ('admin','top_management','top_management_manager') THEN
    RAISE EXCEPTION 'Not authorized to revoke duty' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO org_id FROM public.organizations
    WHERE slug = caller.organization_slug AND is_active = true;
  SELECT * INTO employee FROM public.profiles
    WHERE id = _user_id AND organization_slug = caller.organization_slug FOR UPDATE;
  IF org_id IS NULL OR employee.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.hotel_configurations h
    WHERE h.id = _hotel_configuration_id AND h.organization_id = org_id
  ) THEN
    RAISE EXCEPTION 'Employee or hotel is outside your organization' USING ERRCODE = '42501';
  END IF;
  UPDATE public.property_duty_grants
    SET revoked_at = now(), revoked_by = caller.id
    WHERE user_id = employee.id AND organization_id = org_id
      AND hotel_configuration_id = _hotel_configuration_id AND revoked_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  UPDATE public.property_duty_sessions SET ended_at = now(), ended_by = caller.id
    WHERE user_id = employee.id AND organization_id = org_id
      AND hotel_configuration_id = _hotel_configuration_id AND ended_at IS NULL;
  RETURN changed > 0;
END;
$fn$;

-- Returns only explicitly granted, same-company active destinations.
CREATE OR REPLACE FUNCTION public.list_property_duty_hotels()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'hotel_configuration_id', h.id, 'hotel_id', h.hotel_id,
    'hotel_name', h.hotel_name, 'organization_slug', o.slug,
    'can_manage', g.can_manage
  ) ORDER BY h.hotel_name), '[]'::jsonb)
  FROM public.profiles p
  JOIN public.organizations o ON o.slug = p.organization_slug AND o.is_active = true
  JOIN public.property_duty_grants g ON g.user_id = p.id AND g.organization_id = o.id
    AND g.revoked_at IS NULL
  JOIN public.hotel_configurations h ON h.id = g.hotel_configuration_id
    AND h.organization_id = o.id AND h.is_active = true
  WHERE p.id = auth.uid() AND p.deleted_at IS NULL
    AND p.role::text IN ('maintenance','maintenance_manager','reception','reception_manager',
      'front_office','manager','admin','top_management','top_management_manager');
$fn$;

-- Serialize starts per user by locking their profile; an open session is
-- closed before a new one is inserted. No INSERT permission exists via REST.
CREATE OR REPLACE FUNCTION public.start_property_duty(_hotel_configuration_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  caller public.profiles%rowtype;
  destination public.hotel_configurations%rowtype;
  org public.organizations%rowtype;
  duty public.property_duty_sessions%rowtype;
BEGIN
  SELECT * INTO caller FROM public.profiles
    WHERE id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF caller.id IS NULL OR caller.organization_slug IS NULL OR caller.role::text NOT IN (
    'maintenance','maintenance_manager','reception','reception_manager',
    'front_office','manager','admin','top_management','top_management_manager'
  ) THEN
    RAISE EXCEPTION 'This employee cannot start temporary duty' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO org FROM public.organizations
    WHERE slug = caller.organization_slug AND is_active = true;
  SELECT * INTO destination FROM public.hotel_configurations h
    WHERE h.id = _hotel_configuration_id AND h.organization_id = org.id
      AND h.is_active = true;
  IF org.id IS NULL OR destination.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.property_duty_grants g
    WHERE g.user_id = caller.id AND g.organization_id = org.id
      AND g.hotel_configuration_id = destination.id AND g.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'No authorized temporary duty at this property' USING ERRCODE = '42501';
  END IF;
  UPDATE public.property_duty_sessions
    SET ended_at = now(), ended_by = caller.id
    WHERE user_id = caller.id AND ended_at IS NULL;
  INSERT INTO public.property_duty_sessions
    (user_id, organization_id, hotel_configuration_id, started_by)
  VALUES (caller.id, org.id, destination.id, caller.id)
  RETURNING * INTO duty;
  RETURN jsonb_build_object(
    'id', duty.id, 'hotel_configuration_id', destination.id,
    'hotel_id', destination.hotel_id, 'hotel_name', destination.hotel_name,
    'organization_slug', org.slug, 'started_at', duty.started_at,
    'expires_at', duty.expires_at
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.current_property_duty()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT jsonb_build_object(
    'id', s.id, 'hotel_configuration_id', h.id,
    'hotel_id', h.hotel_id, 'hotel_name', h.hotel_name,
    'organization_slug', o.slug, 'started_at', s.started_at,
    'expires_at', s.expires_at
  )
  FROM public.property_duty_sessions s
  JOIN public.profiles p ON p.id = s.user_id AND p.deleted_at IS NULL
  JOIN public.organizations o ON o.id = s.organization_id
    AND o.slug = p.organization_slug AND o.is_active = true
  JOIN public.hotel_configurations h ON h.id = s.hotel_configuration_id
    AND h.organization_id = o.id AND h.is_active = true
  JOIN public.property_duty_grants g ON g.user_id = p.id
    AND g.organization_id = o.id AND g.hotel_configuration_id = h.id AND g.revoked_at IS NULL
  WHERE s.user_id = auth.uid() AND s.ended_at IS NULL AND s.expires_at > now()
    AND p.role::text IN ('maintenance','maintenance_manager','reception','reception_manager',
      'front_office','manager','admin','top_management','top_management_manager')
  ORDER BY s.started_at DESC LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.end_property_duty()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  changed integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.property_duty_sessions
    SET ended_at = now(), ended_by = auth.uid()
    WHERE user_id = auth.uid() AND ended_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END;
$fn$;

-- This function is explicitly scoped to the caller's own hotel or current
-- validated duty property; it never enumerates another organization's staff.
CREATE OR REPLACE FUNCTION public.get_property_on_duty_staff(_hotel_configuration_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', staff.id, 'full_name', staff.full_name,
    'role', staff.role::text, 'started_at', s.started_at,
    'expires_at', s.expires_at
  ) ORDER BY staff.full_name), '[]'::jsonb)
  FROM public.profiles caller
  JOIN public.organizations o ON o.slug = caller.organization_slug AND o.is_active = true
  JOIN public.hotel_configurations h ON h.id = _hotel_configuration_id
    AND h.organization_id = o.id AND h.is_active = true
  JOIN public.property_duty_sessions s ON s.organization_id = o.id
    AND s.hotel_configuration_id = h.id AND s.ended_at IS NULL AND s.expires_at > now()
  JOIN public.profiles staff ON staff.id = s.user_id AND staff.organization_slug = o.slug
    AND staff.deleted_at IS NULL
  JOIN public.property_duty_grants g ON g.user_id = staff.id
    AND g.organization_id = o.id AND g.hotel_configuration_id = h.id AND g.revoked_at IS NULL
  WHERE caller.id = auth.uid() AND caller.deleted_at IS NULL
    AND (public.maintenance_hotel_matches(caller.assigned_hotel, h.hotel_id, o.slug)
      OR caller.role::text IN ('admin','top_management','top_management_manager')
      OR EXISTS (
        SELECT 1 FROM public.property_duty_sessions own
        WHERE own.user_id = caller.id AND own.organization_id = o.id
          AND own.hotel_configuration_id = h.id AND own.ended_at IS NULL AND own.expires_at > now()
      ));
$fn$;

REVOKE ALL ON FUNCTION public.grant_property_duty(uuid,uuid,boolean),
  public.revoke_property_duty(uuid,uuid), public.list_property_duty_hotels(),
  public.start_property_duty(uuid), public.current_property_duty(),
  public.end_property_duty(), public.get_property_on_duty_staff(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_property_duty(uuid,uuid,boolean),
  public.revoke_property_duty(uuid,uuid), public.list_property_duty_hotels(),
  public.start_property_duty(uuid), public.current_property_duty(),
  public.end_property_duty(), public.get_property_on_duty_staff(uuid)
  TO authenticated;
