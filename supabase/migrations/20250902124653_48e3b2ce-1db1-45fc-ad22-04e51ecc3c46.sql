-- Fix critical security vulnerability: Restrict department_access_config visibility
-- This prevents attackers from mapping internal role structures and access policies

-- Drop the overly permissive policy that allows all users to view access config
DROP POLICY IF EXISTS "All authenticated users can view access config" ON public.department_access_config;

-- Create a secure policy that only allows admin users to view the access configuration
CREATE POLICY "Only admins can view access config" 
ON public.department_access_config 
FOR SELECT 
USING (get_user_role(auth.uid()) = 'admin'::user_role);

-- Note: The get_user_access_config function will still work for all users because:
-- 1. It's marked as SECURITY DEFINER, so it runs with admin privileges
-- 2. It only returns access config for the user's own role, not all roles
-- 3. This maintains functionality while securing direct table access