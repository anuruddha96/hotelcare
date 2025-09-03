-- Fix housekeeping manager permissions to view and manage housekeeping staff

-- 1) Update profiles RLS policies to allow housekeeping_manager to view housekeeping staff
DROP POLICY IF EXISTS "profiles_select_admin_hr" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_admin" ON public.profiles;

-- Allow admins, HR, and housekeeping_manager to view profiles
CREATE POLICY "profiles_select_admin_hr_hm"
ON public.profiles
FOR SELECT
USING (
  get_current_user_role() IN ('admin','hr','housekeeping_manager')
);

-- Allow admins and housekeeping_manager to update profiles
CREATE POLICY "profiles_update_admin_hm"
ON public.profiles
FOR UPDATE
USING (
  get_current_user_role() IN ('admin','housekeeping_manager')
);

-- Allow admins and housekeeping_manager to insert profiles  
CREATE POLICY "profiles_insert_admin_hm"
ON public.profiles
FOR INSERT
WITH CHECK (
  get_current_user_role() IN ('admin','housekeeping_manager')
);