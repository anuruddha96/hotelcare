-- Fix RLS policies for dirty_linen_counts to properly filter by hotel

-- Drop existing policies
DROP POLICY IF EXISTS "Housekeepers can view their own counts" ON public.dirty_linen_counts;
DROP POLICY IF EXISTS "Housekeepers can create their own counts" ON public.dirty_linen_counts;
DROP POLICY IF EXISTS "Housekeepers can update their own counts" ON public.dirty_linen_counts;
DROP POLICY IF EXISTS "Housekeepers and managers can delete linen counts" ON public.dirty_linen_counts;

-- Create improved policies that filter by hotel for managers

-- SELECT policy: Housekeepers see their own, managers see their hotel only
CREATE POLICY "Housekeepers and managers can view linen counts by hotel"
ON public.dirty_linen_counts
FOR SELECT
USING (
  -- Super admin sees all
  is_super_admin(auth.uid())
  OR
  -- User is the housekeeper who created the record
  (housekeeper_id = auth.uid())
  OR
  -- Manager/Admin can see records from their assigned hotel only
  (
    get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = dirty_linen_counts.room_id
      AND (
        -- Match by hotel_id
        r.hotel = get_user_assigned_hotel(auth.uid())
        OR
        -- Match by hotel name (for backward compatibility)
        r.hotel = (SELECT hotel_name FROM public.hotel_configurations WHERE hotel_id = get_user_assigned_hotel(auth.uid()) LIMIT 1)
      )
    )
  )
);

-- INSERT policy: Housekeepers can create their own counts
CREATE POLICY "Housekeepers can create their own counts"
ON public.dirty_linen_counts
FOR INSERT
WITH CHECK (
  (housekeeper_id = auth.uid())
  AND (get_user_role(auth.uid()) = ANY (ARRAY['housekeeping'::user_role, 'manager'::user_role, 'admin'::user_role]))
);

-- UPDATE policy: Housekeepers can update their own, managers can update their hotel's
CREATE POLICY "Housekeepers and managers can update linen counts"
ON public.dirty_linen_counts
FOR UPDATE
USING (
  (housekeeper_id = auth.uid())
  OR
  (
    get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = dirty_linen_counts.room_id
      AND (
        r.hotel = get_user_assigned_hotel(auth.uid())
        OR
        r.hotel = (SELECT hotel_name FROM public.hotel_configurations WHERE hotel_id = get_user_assigned_hotel(auth.uid()) LIMIT 1)
      )
    )
  )
);

-- DELETE policy: Housekeepers can delete their own, managers can delete their hotel's
CREATE POLICY "Housekeepers and managers can delete linen counts"
ON public.dirty_linen_counts
FOR DELETE
USING (
  (housekeeper_id = auth.uid())
  OR
  (
    get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = dirty_linen_counts.room_id
      AND (
        r.hotel = get_user_assigned_hotel(auth.uid())
        OR
        r.hotel = (SELECT hotel_name FROM public.hotel_configurations WHERE hotel_id = get_user_assigned_hotel(auth.uid()) LIMIT 1)
      )
    )
  )
);