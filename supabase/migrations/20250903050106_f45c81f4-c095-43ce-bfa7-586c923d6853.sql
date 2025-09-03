-- Remove the problematic view and just rely on secure functions and RLS policies
DROP VIEW IF EXISTS public.staff_directory;

-- Update the manager policy to be more restrictive - remove email access completely
DROP POLICY IF EXISTS "Managers can view limited staff info" ON public.profiles;

-- Create a new policy for managers that explicitly excludes sensitive data
-- Managers should use the secure function instead of direct table access
CREATE POLICY "Managers cannot directly access profiles table" 
ON public.profiles 
FOR SELECT 
USING (false) 
-- This policy will prevent managers from accessing the profiles table directly
-- They must use the get_assignable_staff_secure function instead

-- Since we removed manager access, we need to ensure users can still see assignable staff
-- through the secure function