-- Fix RLS policy for dirty_linen_counts deletion to ensure it works properly
DROP POLICY IF EXISTS "Only managers can delete linen counts" ON public.dirty_linen_counts;

CREATE POLICY "Housekeepers and managers can delete linen counts"
ON public.dirty_linen_counts
FOR DELETE
USING (
  housekeeper_id = auth.uid() OR 
  get_user_role(auth.uid()) = ANY(ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
);

-- Add RLS policy for room_minibar_usage deletion for admins and managers
DROP POLICY IF EXISTS "All staff can update minibar usage" ON public.room_minibar_usage;

CREATE POLICY "All staff can update minibar usage"
ON public.room_minibar_usage
FOR UPDATE
USING (true)
WITH CHECK (true);

CREATE POLICY "Admins and managers can delete minibar records"
ON public.room_minibar_usage
FOR DELETE
USING (
  get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role])
);

-- Add delete policies for photos - admins and super admins only
CREATE POLICY "Admins can delete DND photos"
ON public.dnd_photos
FOR DELETE
USING (
  get_user_role(auth.uid()) = 'admin'::user_role OR 
  is_super_admin(auth.uid()) = true
);

-- Add delete policy for lost_and_found
CREATE POLICY "Admins can delete lost and found records"
ON public.lost_and_found
FOR DELETE
USING (
  get_user_role(auth.uid()) = 'admin'::user_role OR 
  is_super_admin(auth.uid()) = true
);

-- Add delete policy for maintenance_issues
CREATE POLICY "Admins can delete maintenance issues"
ON public.maintenance_issues
FOR DELETE
USING (
  get_user_role(auth.uid()) = 'admin'::user_role OR 
  is_super_admin(auth.uid()) = true
);