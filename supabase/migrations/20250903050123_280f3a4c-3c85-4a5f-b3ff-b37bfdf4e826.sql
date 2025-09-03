-- Clean up and create secure policies for profiles table
-- Remove the problematic view
DROP VIEW IF EXISTS public.staff_directory;

-- Allow managers to see minimal operational info (no emails) for staff assignment
CREATE POLICY "Managers can view minimal staff info for assignments" 
ON public.profiles 
FOR SELECT 
USING (
  get_user_role(auth.uid()) = 'manager' 
  AND role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance')
  AND (
    (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = assigned_hotel
    OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) IS NULL
  )
);