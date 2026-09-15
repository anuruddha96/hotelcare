-- Harden global access-policy administration.
-- department_access_config is a global role-policy table, so ordinary organization
-- admins must not be able to mutate it directly from a browser client.

CREATE TABLE IF NOT EXISTS public.access_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  actor_role user_role,
  actor_organization_slug text,
  action text NOT NULL CHECK (action IN ('create', 'delete')),
  rule_id uuid,
  before_state jsonb,
  after_state jsonb,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, request_id)
);

ALTER TABLE public.access_policy_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can view access policy audit" ON public.access_policy_events;
CREATE POLICY "Super admins can view access policy audit"
ON public.access_policy_events
FOR SELECT
TO authenticated
USING (COALESCE(public.is_super_admin(auth.uid()), false));

-- Remove browser-side mutation authority. Keep read access for admins so older
-- read-only clients do not break; writes now go only through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "Admins can manage access config" ON public.department_access_config;
DROP POLICY IF EXISTS "Only admins can view access config" ON public.department_access_config;
DROP POLICY IF EXISTS "All authenticated users can view access config" ON public.department_access_config;

CREATE POLICY "Admins can view access config"
ON public.department_access_config
FOR SELECT
TO authenticated
USING (
  public.get_user_role(auth.uid()) = 'admin'::user_role
  OR COALESCE(public.is_super_admin(auth.uid()), false)
);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.department_access_config FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_access_rules()
RETURNS TABLE(
  id uuid,
  role user_role,
  department text,
  access_scope text,
  can_manage_all boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role(auth.uid()) <> 'admin'::user_role
     AND NOT COALESCE(public.is_super_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    dac.id,
    dac.role,
    dac.department,
    dac.access_scope,
    dac.can_manage_all,
    dac.created_at,
    dac.updated_at
  FROM public.department_access_config dac
  ORDER BY dac.role::text, dac.department;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_access_rule(
  p_role user_role,
  p_department text,
  p_access_scope text,
  p_can_manage_all boolean DEFAULT false,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE(
  id uuid,
  role user_role,
  department text,
  access_scope text,
  can_manage_all boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role user_role;
  v_actor_org text;
  v_rule public.department_access_config%ROWTYPE;
  v_existing_action text;
  v_existing_rule_id uuid;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(public.is_super_admin(v_actor_id), false) THEN
    RAISE EXCEPTION 'Super admin access required to change global access rules' USING ERRCODE = '42501';
  END IF;

  -- Serialize all policy mutations so concurrent create/delete requests cannot
  -- bypass uniqueness or the final-global-rule lockout check.
  PERFORM pg_advisory_xact_lock(
    hashtext('hotelcare'),
    hashtext('department_access_config')
  );

  SELECT p.role, p.organization_slug
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  SELECT e.action, e.rule_id
  INTO v_existing_action, v_existing_rule_id
  FROM public.access_policy_events e
  WHERE e.actor_id = v_actor_id
    AND e.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing_action <> 'create' THEN
      RAISE EXCEPTION 'Request id already used for a different access-policy action';
    END IF;

    RETURN QUERY
    SELECT
      dac.id,
      dac.role,
      dac.department,
      dac.access_scope,
      dac.can_manage_all,
      dac.created_at,
      dac.updated_at
    FROM public.department_access_config dac
    WHERE dac.id = v_existing_rule_id;
    RETURN;
  END IF;

  IF p_department IS NULL OR p_department NOT IN (
    'all', 'housekeeping', 'maintenance', 'reception', 'front_office',
    'marketing', 'finance', 'hr', 'control'
  ) THEN
    RAISE EXCEPTION 'Invalid department';
  END IF;

  IF p_access_scope IS NULL OR p_access_scope NOT IN (
    'hotel_only', 'all_hotels', 'assigned_and_created'
  ) THEN
    RAISE EXCEPTION 'Invalid access scope';
  END IF;

  IF COALESCE(p_can_manage_all, false)
     AND (p_department <> 'all' OR p_access_scope <> 'all_hotels') THEN
    RAISE EXCEPTION 'Super-admin rules must use department=all and access_scope=all_hotels';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.department_access_config dac
    WHERE dac.role = p_role
      AND dac.department = p_department
  ) THEN
    RAISE EXCEPTION 'An access rule already exists for role % and department %', p_role, p_department
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.department_access_config (
    role,
    department,
    access_scope,
    can_manage_all
  )
  VALUES (
    p_role,
    p_department,
    p_access_scope,
    COALESCE(p_can_manage_all, false)
  )
  RETURNING * INTO v_rule;

  INSERT INTO public.access_policy_events (
    actor_id,
    actor_role,
    actor_organization_slug,
    action,
    rule_id,
    before_state,
    after_state,
    request_id
  )
  VALUES (
    v_actor_id,
    v_actor_role,
    v_actor_org,
    'create',
    v_rule.id,
    NULL,
    to_jsonb(v_rule),
    p_request_id
  );

  RETURN QUERY
  SELECT
    v_rule.id,
    v_rule.role,
    v_rule.department,
    v_rule.access_scope,
    v_rule.can_manage_all,
    v_rule.created_at,
    v_rule.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_access_rule(
  p_rule_id uuid,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role user_role;
  v_actor_org text;
  v_rule public.department_access_config%ROWTYPE;
  v_existing_action text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE(public.is_super_admin(v_actor_id), false) THEN
    RAISE EXCEPTION 'Super admin access required to change global access rules' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('hotelcare'),
    hashtext('department_access_config')
  );

  SELECT e.action
  INTO v_existing_action
  FROM public.access_policy_events e
  WHERE e.actor_id = v_actor_id
    AND e.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing_action <> 'delete' THEN
      RAISE EXCEPTION 'Request id already used for a different access-policy action';
    END IF;
    RETURN true;
  END IF;

  SELECT *
  INTO v_rule
  FROM public.department_access_config dac
  WHERE dac.id = p_rule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access rule not found' USING ERRCODE = 'P0002';
  END IF;

  -- Never allow the final broad management rule to disappear. This keeps at
  -- least one policy path capable of seeing all departments/hotels.
  IF v_rule.can_manage_all
     AND NOT EXISTS (
       SELECT 1
       FROM public.department_access_config dac
       WHERE dac.id <> v_rule.id
         AND dac.can_manage_all = true
     ) THEN
    RAISE EXCEPTION 'Cannot delete the final global management rule' USING ERRCODE = '23514';
  END IF;

  SELECT p.role, p.organization_slug
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id;

  DELETE FROM public.department_access_config
  WHERE department_access_config.id = v_rule.id;

  INSERT INTO public.access_policy_events (
    actor_id,
    actor_role,
    actor_organization_slug,
    action,
    rule_id,
    before_state,
    after_state,
    request_id
  )
  VALUES (
    v_actor_id,
    v_actor_role,
    v_actor_org,
    'delete',
    v_rule.id,
    to_jsonb(v_rule),
    NULL,
    p_request_id
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_access_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_access_rule(user_role, text, text, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_access_rule(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_access_rules() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_access_rule(user_role, text, text, boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_access_rule(uuid, uuid) TO authenticated;
