-- Resolve infinite recursion in profiles RLS by removing self-references
-- 1) Drop current profiles policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "HR can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile safely" ON public.profiles;
DROP POLICY IF EXISTS "Only admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can view minimal staff info for assignments" ON public.profiles;
DROP POLICY IF EXISTS "Managers can view limited staff info" ON public.profiles;

-- 2) Create a SECURITY DEFINER helper that bypasses RLS safely
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- 3) Re-create minimal, non-recursive policies using the helper only
-- View own profile
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

-- HR/Admin can view all
CREATE POLICY "profiles_select_admin_hr"
ON public.profiles
FOR SELECT
USING (public.get_current_user_role() IN ('admin','hr'));

-- Admin can insert
CREATE POLICY "profiles_insert_admin"
ON public.profiles
FOR INSERT
WITH CHECK (public.get_current_user_role() = 'admin');

-- Admin can update any profile
CREATE POLICY "profiles_update_admin"
ON public.profiles
FOR UPDATE
USING (public.get_current_user_role() = 'admin');

-- Users can update own profile
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Admin can delete
CREATE POLICY "profiles_delete_admin"
ON public.profiles
FOR DELETE
USING (public.get_current_user_role() = 'admin');