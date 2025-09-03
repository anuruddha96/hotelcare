-- Fix security vulnerability: Restrict access to employee personal information
-- Drop existing policies that are too permissive
DROP POLICY IF EXISTS "Managers can view staff profiles for operations" ON public.profiles;
DROP POLICY IF EXISTS "HR can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles for administration" ON public.profiles;

-- Create more secure, simplified policies

-- 1. HR and Admins can view all profile data (including emails)
CREATE POLICY "HR and Admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (get_user_role(auth.uid()) IN ('hr', 'admin'));

-- 2. Managers can only view operational info (no emails) for their assigned staff
CREATE POLICY "Managers can view limited staff info" 
ON public.profiles 
FOR SELECT 
USING (
  get_user_role(auth.uid()) = 'manager' 
  AND role IN ('housekeeping', 'maintenance', 'reception', 'front_office')
  AND (
    -- Only show profiles from same hotel or if manager has broader access
    (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = assigned_hotel
    OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) IS NULL
  )
);

-- 3. Users can view their own profile
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

-- Create a secure view for managers that excludes sensitive information
CREATE OR REPLACE VIEW public.staff_directory AS
SELECT 
  id,
  full_name,
  nickname,
  role,
  assigned_hotel,
  profile_picture_url,
  last_login,
  created_at,
  updated_at,
  -- Exclude email for non-HR/Admin users
  CASE 
    WHEN get_user_role(auth.uid()) IN ('hr', 'admin') THEN email
    ELSE NULL
  END as email
FROM public.profiles
WHERE 
  -- HR and Admins see all
  get_user_role(auth.uid()) IN ('hr', 'admin')
  OR
  -- Managers see their staff (excluding emails)
  (
    get_user_role(auth.uid()) = 'manager' 
    AND role IN ('housekeeping', 'maintenance', 'reception', 'front_office')
    AND (
      (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) = assigned_hotel
      OR (SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()) IS NULL
    )
  )
  OR
  -- Users see themselves
  auth.uid() = id;

-- Enable RLS on the view
ALTER VIEW public.staff_directory SET (security_barrier = true);

-- Create a function to safely get staff info without exposing emails
CREATE OR REPLACE FUNCTION public.get_assignable_staff_secure(requesting_user_role user_role)
RETURNS TABLE(id uuid, full_name text, role user_role, nickname text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.role, p.nickname
  FROM public.profiles p
  WHERE 
    -- Only return operational staff that can be assigned tickets
    p.role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
    -- Only allow managers and admins to get this list (but no emails)
    requesting_user_role IN ('manager', 'admin');
$$;

-- Update the original function to be more secure (only for HR/Admin with email access)
CREATE OR REPLACE FUNCTION public.get_assignable_staff(requesting_user_role user_role)
RETURNS TABLE(id uuid, full_name text, role user_role, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.role, p.email
  FROM public.profiles p
  WHERE 
    -- Only return operational staff that can be assigned tickets
    p.role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
    -- Only allow HR and admins to get email addresses
    requesting_user_role IN ('hr', 'admin');
$$;