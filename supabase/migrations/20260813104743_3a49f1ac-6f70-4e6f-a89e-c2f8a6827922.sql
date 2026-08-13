DROP POLICY IF EXISTS "Housekeepers can view other housekeepers in same hotel" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin_hr_hm_manager" ON public.profiles;
CREATE POLICY "Staff view permitted profiles in their organization"
ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = id
  OR public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND deleted_at IS NULL
    AND (
      public.get_user_role(auth.uid()) IN ('admin','hr','housekeeping_manager','manager','top_management','top_management_manager')
      OR (
        public.get_user_role(auth.uid()) = 'housekeeping'
        AND role = 'housekeeping'
        AND assigned_hotel = public.get_user_assigned_hotel(auth.uid())
      )
    )
  )
);

DROP POLICY IF EXISTS "profiles_update_authorized" ON public.profiles;
CREATE POLICY "Managers update permitted profiles in their organization"
ON public.profiles FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_current_user_role() IN ('admin','housekeeping_manager','manager')
    AND (
      public.get_current_user_role() = 'admin'
      OR public.manager_assignable_role(role)
    )
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_current_user_role() IN ('admin','housekeeping_manager','manager')
    AND (
      public.get_current_user_role() = 'admin'
      OR public.manager_assignable_role(role)
    )
  )
);

CREATE OR REPLACE FUNCTION public.guard_profile_tenant_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role public.user_role;
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      RAISE EXCEPTION 'Protected profile fields cannot be changed' USING ERRCODE = '42501';
    END IF;

    IF NEW.assigned_hotel IS DISTINCT FROM OLD.assigned_hotel THEN
      v_caller_role := public.get_user_role(auth.uid());
      IF v_caller_role NOT IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
         OR NEW.assigned_hotel IS NULL
         OR NOT public.user_can_access_hotel(auth.uid(), NEW.assigned_hotel) THEN
        RAISE EXCEPTION 'Property assignment is not allowed' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF NEW.organization_slug IS DISTINCT FROM OLD.organization_slug THEN
    RAISE EXCEPTION 'Users cannot be moved between organizations' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_profile_tenant_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_profile_tenant_fields() TO service_role;
DROP TRIGGER IF EXISTS guard_profile_tenant_fields_trigger ON public.profiles;
CREATE TRIGGER guard_profile_tenant_fields_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_tenant_fields();