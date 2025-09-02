-- Drop and recreate the get_assignable_staff function with email included
DROP FUNCTION IF EXISTS public.get_assignable_staff(user_role);

CREATE OR REPLACE FUNCTION public.get_assignable_staff(requesting_user_role user_role)
RETURNS TABLE (
  id uuid,
  full_name text,
  role user_role,
  email text
) 
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.role, p.email
  FROM public.profiles p
  WHERE 
    -- Only return operational staff that can be assigned tickets
    p.role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
    -- Only allow managers and admins to get this list
    requesting_user_role IN ('manager', 'admin');
$$;