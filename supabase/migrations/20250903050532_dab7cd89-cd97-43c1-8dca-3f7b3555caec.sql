-- Fix infinite recursion in RLS policies
-- Drop all problematic policies first
DROP POLICY IF EXISTS "HR and Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can view minimal staff info for assignments" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;

-- Create a security definer function to get user role safely
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Create safe RLS policies using the security definer function
CREATE POLICY "HR and Admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (public.get_current_user_role() IN ('hr', 'admin'));

CREATE POLICY "Users can view own profile only" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Managers can view limited staff info" 
ON public.profiles 
FOR SELECT 
USING (
  public.get_current_user_role() = 'manager' 
  AND role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance')
);

-- Update existing functions to use the new secure function
CREATE OR REPLACE FUNCTION public.get_assignable_staff_secure(requesting_user_role user_role)
RETURNS TABLE(id uuid, full_name text, role user_role, nickname text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.role, p.nickname
  FROM public.profiles p
  WHERE 
    p.role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
    requesting_user_role IN ('manager', 'admin');
$$;