-- Create security definer function to get user's assigned hotel without triggering RLS
CREATE OR REPLACE FUNCTION public.get_user_assigned_hotel(user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT assigned_hotel FROM public.profiles WHERE id = user_id;
$$;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Housekeepers can view other housekeepers in same hotel" ON public.profiles;

-- Recreate the policy using the security definer function to avoid infinite recursion
CREATE POLICY "Housekeepers can view other housekeepers in same hotel"
ON public.profiles
FOR SELECT
USING (
  (auth.uid() = id) 
  OR (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role])) 
  OR (
    (role = 'housekeeping'::user_role) 
    AND (assigned_hotel IS NOT NULL) 
    AND (assigned_hotel = get_user_assigned_hotel(auth.uid()))
    AND (get_user_role(auth.uid()) = 'housekeeping'::user_role)
  )
);