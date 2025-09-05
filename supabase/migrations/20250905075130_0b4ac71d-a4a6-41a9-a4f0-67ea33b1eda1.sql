-- Fix RLS policy for room_assignments to ensure housekeepers can see their assignments
DROP POLICY IF EXISTS "Housekeeping staff can view their assignments" ON public.room_assignments;

CREATE POLICY "Housekeeping staff can view their assignments" ON public.room_assignments
FOR SELECT USING (
  (assigned_to = auth.uid()) OR 
  (get_user_role(auth.uid()) = ANY(ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role])) OR 
  (assigned_by = auth.uid())
);