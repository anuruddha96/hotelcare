-- Revenue UI treats top_management_manager as a full executive role.
-- Keep occupancy snapshots consistent with that role model while preserving
-- strict organization/property isolation for every non-super-admin user.

DROP POLICY IF EXISTS "occ read for revenue roles" ON public.occupancy_snapshots;

CREATE POLICY "occ read for revenue roles"
ON public.occupancy_snapshots
FOR SELECT
TO authenticated
USING (
  public.user_can_access_hotel(auth.uid(), hotel_id)
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        COALESCE(p.is_super_admin, false)
        OR (
          p.role IN (
            'admin'::public.user_role,
            'top_management'::public.user_role,
            'top_management_manager'::public.user_role,
            'manager'::public.user_role,
            'housekeeping_manager'::public.user_role
          )
          AND p.organization_slug = occupancy_snapshots.organization_slug
        )
      )
  )
);

COMMENT ON POLICY "occ read for revenue roles" ON public.occupancy_snapshots IS
  'Revenue/management users may read occupancy only for hotels they can access; includes top_management_manager and preserves tenant isolation.';
