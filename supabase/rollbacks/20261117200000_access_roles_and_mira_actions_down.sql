-- Rollback for 20261117200000_access_roles_and_mira_actions.sql.
-- Restores the previous work-schedule access and removes access roles, the
-- schedule go-live switch and Mira approval records. Permission levels
-- (profiles.role) were never changed, so nothing else needs restoring.

DROP POLICY IF EXISTS "workforce read staff" ON public.workforce_staff;
CREATE POLICY "workforce read staff" ON public.workforce_staff
  FOR SELECT TO authenticated
  USING (
    organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
    AND (
      (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'org'
      OR profile_id = (SELECT auth.uid())
      OR (
        (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'property'
        AND (
          hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
          OR public.workforce_staff_works_at(id, (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)))
        )
      )
    )
  );

DROP POLICY IF EXISTS "workforce read entries" ON public.workforce_entries;
CREATE POLICY "workforce read entries" ON public.workforce_entries
  FOR SELECT TO authenticated
  USING (
    organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
    AND (
      (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'org'
      OR (
        (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'property'
        AND (
          hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
          OR public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
        )
      )
      OR (status = 'published' AND public.workforce_staff_is_mine(staff_id))
    )
  );

CREATE OR REPLACE FUNCTION public.workforce_access()
RETURNS TABLE(organization_slug text, access_level text, hotel_id text, role text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.organization_slug,
         CASE
           WHEN p.is_super_admin IS TRUE
             OR p.role::text IN ('admin', 'top_management', 'top_management_manager', 'hr') THEN 'org'
           WHEN p.role::text IN ('manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager',
                                 'back_office_manager', 'finance_manager', 'control_manager', 'marketing_manager') THEN 'property'
           ELSE 'self'
         END,
         public.workforce_hotel_key(p.organization_slug, p.assigned_hotel),
         CASE WHEN p.is_super_admin IS TRUE THEN 'admin' ELSE p.role::text END
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
$$;

DROP FUNCTION IF EXISTS public.set_workforce_staff_schedule_live(boolean);
DROP FUNCTION IF EXISTS public.workforce_self_view_allowed();
DROP FUNCTION IF EXISTS public.workforce_staff_schedule_live(text);
DROP TABLE IF EXISTS public.workforce_settings;

DROP TRIGGER IF EXISTS assistant_action_requests_guard ON public.assistant_action_requests;
DROP FUNCTION IF EXISTS public.assistant_action_requests_guard();
DROP TABLE IF EXISTS public.assistant_action_requests;

DROP FUNCTION IF EXISTS public.set_staff_access_role(uuid, text);
DROP TRIGGER IF EXISTS profiles_access_role_guard ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_access_role();
DROP FUNCTION IF EXISTS public.current_access_role();
DROP FUNCTION IF EXISTS public.effective_access_role(text, text);
DROP FUNCTION IF EXISTS public.access_role_allows_permission(text, text);
DROP FUNCTION IF EXISTS public.access_role_from_permission(text);
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_access_role_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS access_role;
