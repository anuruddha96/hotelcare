-- Fix profiles RLS policies to include manager role  
DROP POLICY IF EXISTS "profiles_select_admin_hr_hm" ON public.profiles;

CREATE POLICY "profiles_select_admin_hr_hm_manager" ON public.profiles
FOR SELECT USING (
  get_current_user_role() = ANY (
    ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role]
  )
);

-- Drop and recreate get_user_role function with proper return type
DROP FUNCTION IF EXISTS public.get_user_role(uuid);

CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role::text FROM public.profiles WHERE id = user_id;
$$;