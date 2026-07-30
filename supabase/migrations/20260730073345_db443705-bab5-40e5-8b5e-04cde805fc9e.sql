CREATE OR REPLACE FUNCTION public.soft_delete_user_profile(p_target_user_id uuid, p_caller_id uuid DEFAULT NULL)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := COALESCE(p_caller_id, auth.uid());
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

  IF v_target.role = 'admin' OR COALESCE(v_target.is_super_admin, false) THEN
    RETURN json_build_object('success', false, 'error', 'Cannot delete admin users');
  END IF;

  IF v_caller_role <> 'admin' THEN
    IF v_target.organization_slug IS DISTINCT FROM v_caller_org THEN
      RETURN json_build_object('success', false, 'error', 'Cannot delete users outside your organization');
    END IF;
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
$function$;

CREATE POLICY "Hotel managers can view their PMS configuration"
ON public.pms_configurations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('manager','housekeeping_manager','front_office','top_management')
      AND (
        p.assigned_hotel = pms_configurations.hotel_id
        OR p.assigned_hotel = public.get_hotel_name_from_id(pms_configurations.hotel_id)
      )
  )
);