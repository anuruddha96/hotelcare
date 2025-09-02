-- Fix security issue: Tighten profile access policies
-- Drop existing overly permissive policies and create more restrictive ones

-- First, drop existing SELECT policies for profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Create more restrictive profile viewing policies
-- 1. Users can only view their own profile
CREATE POLICY "Users can view own profile only" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

-- 2. Managers can view profiles but only essential fields for their hotel operations
CREATE POLICY "Managers can view staff profiles for operations" 
ON public.profiles 
FOR SELECT 
USING (
  get_user_role(auth.uid()) = 'manager' AND 
  -- Managers should only see profiles of users in operational roles
  role IN ('housekeeping', 'maintenance', 'reception', 'front_office')
);

-- 3. HR role can view all profiles (assuming HR needs access for personnel management)
CREATE POLICY "HR can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (get_user_role(auth.uid()) = 'hr');

-- 4. Admins can view all profiles (for system administration)
CREATE POLICY "Admins can view all profiles for administration" 
ON public.profiles 
FOR SELECT 
USING (get_user_role(auth.uid()) = 'admin');

-- Add a function to get limited profile data for ticket assignments
CREATE OR REPLACE FUNCTION public.get_assignable_staff(requesting_user_role user_role)
RETURNS TABLE (
  id uuid,
  full_name text,
  role user_role
) 
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.role
  FROM public.profiles p
  WHERE 
    -- Only return operational staff that can be assigned tickets
    p.role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
    -- Only allow managers and admins to get this list
    requesting_user_role IN ('manager', 'admin');
$$;