-- Tighten the previous migration's read policy: the PMS or dated assignment
-- may identify checkout even before rooms.is_checkout_room is refreshed.
-- Supervisors do not receive the manager-only prior-guest incident on checkout.
DROP POLICY IF EXISTS memories_service_carryovers_venue_read
  ON public.memories_service_carryovers;
CREATE POLICY memories_service_carryovers_venue_read
ON public.memories_service_carryovers FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.rooms r
  WHERE r.id = room_id
    AND lower(btrim(r.hotel)) IN ('hotel memories budapest', 'memories')
    AND public.user_can_access_hotel(auth.uid(), r.hotel)
    AND (
      NOT (
        coalesce(r.is_checkout_room, false)
        OR lower(coalesce(r.pms_metadata ->> 'scheduledDepartureToday', 'false')) = 'true'
        OR EXISTS (
          SELECT 1 FROM public.room_assignments a
          WHERE a.room_id = r.id
            AND a.assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
            AND a.assignment_type::text = 'checkout_cleaning'
        )
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
          AND (coalesce(p.is_super_admin, false)
            OR p.role::text IN ('admin', 'manager', 'top_management',
              'top_management_manager', 'housekeeping_manager'))
      )
    )
));
