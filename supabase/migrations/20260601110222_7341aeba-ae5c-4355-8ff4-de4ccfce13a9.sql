
-- Expand rooms SELECT policy so top management and housekeeping_manager can read
DROP POLICY IF EXISTS "Users can view rooms based on role and assignment" ON public.rooms;

CREATE POLICY "Users can view rooms based on role and assignment" ON public.rooms
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.organization_slug = rooms.organization_slug
    AND (
      profiles.role IN ('admin','top_management','top_management_manager')
      OR (
        profiles.role IN ('manager','housekeeping_manager','reception','front_office')
        AND (
          rooms.hotel = profiles.assigned_hotel
          OR EXISTS (
            SELECT 1 FROM public.hotel_configurations hc
            WHERE profiles.assigned_hotel IN (hc.hotel_id, hc.hotel_name)
            AND rooms.hotel IN (hc.hotel_id, hc.hotel_name)
          )
        )
      )
      OR profiles.role = 'housekeeping'
    )
  )
);

-- Expand room_assignments SELECT so executives can view (read-only)
DROP POLICY IF EXISTS "Housekeeping staff can view their assignments" ON public.room_assignments;
CREATE POLICY "Housekeeping staff can view their assignments" ON public.room_assignments
FOR SELECT USING (
  is_super_admin(auth.uid())
  OR (
    organization_slug = get_user_organization_slug(auth.uid())
    AND (
      (assigned_to = auth.uid())
      OR (assigned_by = auth.uid())
      OR (get_user_role(auth.uid()) = ANY (ARRAY[
        'housekeeping_manager'::user_role,
        'manager'::user_role,
        'admin'::user_role,
        'top_management'::user_role,
        'top_management_manager'::user_role,
        'reception'::user_role,
        'front_office'::user_role
      ]))
    )
  )
);
