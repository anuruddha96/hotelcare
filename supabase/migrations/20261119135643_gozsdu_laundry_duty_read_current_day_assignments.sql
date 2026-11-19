-- Gozsdu Laundryner sees today's property cleaning assignment evidence (read-only).
-- Without this policy, an active Laundryner can see only assignments that the
-- ordinary housekeeper RLS happens to grant, falsely locking checked-out rooms.
-- Existing restrictive organization/active-hotel policies still apply.
-- No UPDATE, INSERT, DELETE, room status, PMS state or linen counts are changed.
DROP POLICY IF EXISTS "Gozsdu Laundryner can read today's property assignments"
  ON public.room_assignments;

CREATE POLICY "Gozsdu Laundryner can read today's property assignments"
  ON public.room_assignments
  FOR SELECT
  TO authenticated
  USING (
    organization_slug = 'rdhotels'
    AND assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
    AND EXISTS (
      SELECT 1 FROM public.profiles caller
      WHERE caller.id = (SELECT auth.uid())
        AND caller.organization_slug = room_assignments.organization_slug
        AND caller.deleted_at IS NULL
        AND caller.assigned_hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
        AND (caller.role::text = 'housekeeping' OR COALESCE(caller.acts_as_housekeeper, false))
    )
    AND EXISTS (
      SELECT 1 FROM public.gozsdu_laundry_duties duty
      WHERE duty.user_id = (SELECT auth.uid())
        AND duty.organization_slug = room_assignments.organization_slug
        AND duty.hotel_id = 'gozsdu-court'
        AND duty.work_date = room_assignments.assignment_date
    )
    AND EXISTS (
      SELECT 1 FROM public.rooms room
      WHERE room.id = room_assignments.room_id
        AND room.organization_slug = room_assignments.organization_slug
        AND room.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest')
    )
  );
