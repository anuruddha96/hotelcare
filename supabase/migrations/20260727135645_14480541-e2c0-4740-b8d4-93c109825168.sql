
-- 1. Add soft delete columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Replace SELECT policies to hide deleted users from non-privileged roles
DROP POLICY IF EXISTS "profiles_select_admin_hr_hm_manager" ON public.profiles;
CREATE POLICY "profiles_select_admin_hr_hm_manager"
  ON public.profiles FOR SELECT
  USING (
    get_current_user_role() = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role, 'top_management_manager'::user_role])
    AND (
      deleted_at IS NULL
      OR get_current_user_role() = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'top_management'::user_role])
    )
  );

DROP POLICY IF EXISTS "Housekeepers can view other housekeepers in same hotel" ON public.profiles;
CREATE POLICY "Housekeepers can view other housekeepers in same hotel"
  ON public.profiles FOR SELECT
  USING (
    (
      auth.uid() = id
      OR get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role, 'top_management_manager'::user_role])
      OR (
        role = 'housekeeping'::user_role
        AND assigned_hotel IS NOT NULL
        AND assigned_hotel = get_user_assigned_hotel(auth.uid())
        AND get_user_role(auth.uid()) = 'housekeeping'::user_role
      )
    )
    AND (
      deleted_at IS NULL
      OR auth.uid() = id
      OR get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'top_management'::user_role])
    )
  );

DROP POLICY IF EXISTS "Reception can view profiles in organization" ON public.profiles;
CREATE POLICY "Reception can view profiles in organization"
  ON public.profiles FOR SELECT
  USING (
    get_user_role(auth.uid()) = 'reception'::user_role
    AND organization_slug = get_user_organization_slug(auth.uid())
    AND deleted_at IS NULL
  );

-- 3. Soft delete function callable by admin / manager / housekeeping_manager
CREATE OR REPLACE FUNCTION public.soft_delete_user_profile(p_target_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_role user_role;
  v_caller_org text;
  v_caller_hotel text;
  v_target public.profiles%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT role, organization_slug, assigned_hotel
    INTO v_caller_role, v_caller_org, v_caller_hotel
    FROM public.profiles WHERE id = v_caller;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin','manager','housekeeping_manager') THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_target_user_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'User not found');
  END IF;

  IF v_target.deleted_at IS NOT NULL THEN
    RETURN json_build_object('success', true, 'already_deleted', true);
  END IF;

  -- Never allow deleting admins or super-admins via this path
  IF v_target.role = 'admin' OR COALESCE(v_target.is_super_admin, false) THEN
    RETURN json_build_object('success', false, 'error', 'Cannot delete admin users');
  END IF;

  -- Non-admin callers can only delete staff in their organization
  IF v_caller_role <> 'admin' THEN
    IF v_target.organization_slug IS DISTINCT FROM v_caller_org THEN
      RETURN json_build_object('success', false, 'error', 'Cannot delete users outside your organization');
    END IF;
    -- housekeeping_manager can only delete housekeeping staff
    IF v_caller_role = 'housekeeping_manager'
       AND v_target.role NOT IN ('housekeeping') THEN
      RETURN json_build_object('success', false, 'error', 'Housekeeping managers can only delete housekeeping staff');
    END IF;
  END IF;

  UPDATE public.profiles
     SET deleted_at = now(),
         deleted_by = v_caller
   WHERE id = p_target_user_id;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_user_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_user_profile(uuid) TO authenticated, service_role;
