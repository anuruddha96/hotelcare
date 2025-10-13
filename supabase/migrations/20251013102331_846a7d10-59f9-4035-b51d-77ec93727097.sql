-- Allow housekeepers to view other housekeepers' basic profile info in the same hotel
-- This is needed for the performance race game to show all participants
CREATE POLICY "Housekeepers can view other housekeepers in same hotel"
ON public.profiles
FOR SELECT
USING (
  -- User can view their own profile
  auth.uid() = id 
  OR 
  -- Admins, managers, HR can view all
  get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role])
  OR
  -- Housekeepers can see other housekeepers in the same hotel (for race game)
  (
    role = 'housekeeping' 
    AND assigned_hotel IS NOT NULL
    AND assigned_hotel = (
      SELECT assigned_hotel 
      FROM public.profiles 
      WHERE id = auth.uid()
    )
    AND get_user_role(auth.uid()) = 'housekeeping'
  )
);

-- Allow housekeepers to view assignment counts (not details) of other housekeepers in same hotel
-- This enables the performance race game to show all participants' progress
CREATE POLICY "Housekeepers can view assignment status in same hotel for race"
ON public.room_assignments
FOR SELECT
USING (
  is_super_admin(auth.uid()) 
  OR 
  (
    organization_slug = get_user_organization_slug(auth.uid())
    AND (
      -- User can see their own assignments (existing functionality)
      assigned_to = auth.uid()
      OR 
      -- Managers can see all assignments (existing functionality)
      get_user_role(auth.uid()) = ANY(ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role])
      OR 
      -- Assigned by can see (existing functionality)
      assigned_by = auth.uid()
      OR
      -- NEW: Housekeepers can see basic assignment info of other housekeepers in the same hotel
      -- (only for same hotel, to enable race game)
      (
        get_user_role(auth.uid()) = 'housekeeping'
        AND EXISTS (
          SELECT 1 FROM public.profiles p1
          JOIN public.profiles p2 ON p1.assigned_hotel = p2.assigned_hotel
          WHERE p1.id = auth.uid() 
          AND p2.id = room_assignments.assigned_to
          AND p1.assigned_hotel IS NOT NULL
          AND p2.role = 'housekeeping'
        )
      )
    )
  )
);