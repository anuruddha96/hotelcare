-- Restore SLNT housekeepers' read access to the room rows for rooms that are
-- actually assigned to them. The existing permissive rooms policy already
-- recognizes user_assigned_room_ids(), but this restrictive venue policy was
-- vetoing those rows whenever the housekeeper had no user_property_scopes row.
--
-- Keep venue scoping for unassigned rooms and keep all existing manager/admin
-- access. This changes SELECT visibility only; it does not change assignments,
-- room state, PMS data, or write permissions.

DROP POLICY IF EXISTS "rooms_slnt_venue_scope" ON public.rooms;

CREATE POLICY "rooms_slnt_venue_scope"
ON public.rooms
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  COALESCE(organization_slug, '') <> 'slnt'
  OR (SELECT public.is_super_admin((SELECT auth.uid())))
  OR (SELECT public.get_user_role((SELECT auth.uid())))::text = ANY (
    ARRAY[
      'admin'::text,
      'top_management'::text,
      'top_management_manager'::text,
      'manager'::text,
      'housekeeping_manager'::text
    ]
  )
  OR venue_id = ANY (
    (SELECT public.user_slnt_visible_venue_ids((SELECT auth.uid())))::uuid[]
  )
  OR (
    organization_slug = (SELECT public.get_user_organization_slug((SELECT auth.uid())))
    AND (SELECT public.get_user_role((SELECT auth.uid())))::text = 'housekeeping'
    AND id = ANY (
      (SELECT public.user_assigned_room_ids((SELECT auth.uid())))::uuid[]
    )
  )
);
