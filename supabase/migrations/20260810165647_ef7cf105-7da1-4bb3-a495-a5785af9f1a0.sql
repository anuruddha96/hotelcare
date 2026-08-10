CREATE OR REPLACE FUNCTION public.has_hk_manager_powers(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.role IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_top_management(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.role IN ('top_management','top_management_manager')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_hk_manager_powers(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_top_management(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_hk_manager_powers(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_top_management(uuid) TO authenticated, service_role;

-- Additive, org-scoped policies so top management gets manager-level
-- housekeeping powers. Existing policies are left exactly as they are.

DO $mig$
DECLARE
  t text;
  tables text[] := ARRAY[
    'dirty_linen_counts','room_minibar_usage','minibar_placements','dnd_photos',
    'lost_and_found','maintenance_issues','housekeeping_notes','housekeeper_ratings',
    'staff_attendance','break_requests','early_signout_requests','room_assignments'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tm_hk_select_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tm_hk_insert_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tm_hk_update_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tm_hk_delete_' || t, t);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid())))',
      'tm_hk_select_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid())))',
      'tm_hk_insert_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid()))) WITH CHECK (public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid())))',
      'tm_hk_update_' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid())))',
      'tm_hk_delete_' || t, t);
  END LOOP;
END
$mig$;