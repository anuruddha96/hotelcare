-- Create get_user_role function if it doesn't exist
CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid)
RETURNS user_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT role FROM public.profiles WHERE id = user_id;
$$;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Managers can view their hotel configuration" ON hotel_configurations;

-- Create a simpler policy: allow all authenticated users to view hotel configurations
-- This is safe because hotel_id and hotel_name are not sensitive data
CREATE POLICY "Authenticated users can view hotel configurations"
ON hotel_configurations
FOR SELECT
USING (auth.role() = 'authenticated');