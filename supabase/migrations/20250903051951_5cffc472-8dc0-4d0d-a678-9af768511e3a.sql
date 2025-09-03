-- Cleanly re-apply policies: drop if they already exist, then create
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin_hr" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;

-- Ensure helper exists
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Recreate policies
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "profiles_select_admin_hr"
ON public.profiles
FOR SELECT
USING (public.get_current_user_role() IN ('admin','hr'));

CREATE POLICY "profiles_insert_admin"
ON public.profiles
FOR INSERT
WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY "profiles_update_admin"
ON public.profiles
FOR UPDATE
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_delete_admin"
ON public.profiles
FOR DELETE
USING (public.get_current_user_role() = 'admin');