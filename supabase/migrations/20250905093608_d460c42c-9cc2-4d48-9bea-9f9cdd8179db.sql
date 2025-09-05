-- Fix profiles RLS policies to include manager role
DROP POLICY IF EXISTS "profiles_select_admin_hr_hm" ON public.profiles;

CREATE POLICY "profiles_select_admin_hr_hm_manager" ON public.profiles
FOR SELECT USING (
  get_current_user_role() = ANY (
    ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role]
  )
);