-- Fix RLS policies to allow managers to create and update housekeeping profiles

-- Drop existing policies and recreate with proper permissions
DROP POLICY IF EXISTS "profiles_insert_admin_hm" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin_hm" ON public.profiles;

-- Allow admins, housekeeping_manager, and managers to insert profiles
CREATE POLICY "profiles_insert_authorized" ON public.profiles
FOR INSERT 
WITH CHECK (
  get_current_user_role() = ANY (ARRAY[
    'admin'::user_role, 
    'housekeeping_manager'::user_role, 
    'manager'::user_role
  ])
);

-- Allow admins, housekeeping_manager, and managers to update profiles
CREATE POLICY "profiles_update_authorized" ON public.profiles
FOR UPDATE 
USING (
  get_current_user_role() = ANY (ARRAY[
    'admin'::user_role, 
    'housekeeping_manager'::user_role, 
    'manager'::user_role
  ])
);