-- Profile SELECT RLS excludes former staff. Use SECURITY DEFINER identity helpers to
-- preserve historical HR reports while keeping attendance inside the employee's tenant.
DROP POLICY IF EXISTS "Users can view all their own attendance records" ON public.staff_attendance;
CREATE POLICY "Users can view all their own attendance records" ON public.staff_attendance
FOR SELECT TO authenticated USING (
  organization_slug IS NOT NULL
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.get_user_organization_slug(user_id) = organization_slug
  AND (
    user_id = auth.uid()
    OR public.get_user_role(auth.uid())::text IN ('admin','hr','top_management','top_management_manager')
    OR (
      public.get_user_role(auth.uid())::text IN ('manager','housekeeping_manager')
      AND public.get_user_assigned_hotel(auth.uid()) IS NOT NULL
      AND (
        public.get_user_assigned_hotel(user_id) = public.get_user_assigned_hotel(auth.uid())
        OR public.get_user_assigned_hotel(user_id) = public.get_hotel_name_from_id(public.get_user_assigned_hotel(auth.uid()))
        OR public.get_hotel_name_from_id(public.get_user_assigned_hotel(user_id)) = public.get_user_assigned_hotel(auth.uid())
      )
    )
  )
);

DROP POLICY IF EXISTS "tm_hk_select_staff_attendance" ON public.staff_attendance;
CREATE POLICY "tm_hk_select_staff_attendance" ON public.staff_attendance
FOR SELECT TO authenticated USING (
  public.is_top_management(auth.uid())
  AND organization_slug IS NOT NULL
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND public.get_user_organization_slug(user_id) = organization_slug
);
