-- Drop ALL existing policies on profiles table to start clean
DROP POLICY IF EXISTS "HR and Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can view limited staff info for assignments" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile only" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Managers can view limited staff info" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile safely" ON public.profiles;
DROP POLICY IF EXISTS "Only admins can delete profiles" ON public.profiles;

-- Create a security definer function to get user role safely (avoiding recursion)
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Create simple, safe RLS policies
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "HR can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (public.get_current_user_role() = 'hr');

-- Recreate essential admin policies
CREATE POLICY "Admins can insert profiles" 
ON public.profiles 
FOR INSERT 
WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can update all profiles" 
ON public.profiles 
FOR UPDATE 
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Users can update own profile safely" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Only admins can delete profiles" 
ON public.profiles 
FOR DELETE 
USING (public.get_current_user_role() = 'admin');