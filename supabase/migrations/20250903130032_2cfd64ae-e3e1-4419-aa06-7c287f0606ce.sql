-- Allow housekeeping managers to manage and view assignments and staff securely

-- 1) Update get_assignable_staff_secure to include housekeeping_manager and limit to housekeeping role
CREATE OR REPLACE FUNCTION public.get_assignable_staff_secure(requesting_user_role user_role)
RETURNS TABLE(id uuid, full_name text, role user_role, nickname text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.full_name, p.role, p.nickname
  FROM public.profiles p
  WHERE p.role = 'housekeeping'
    AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
$$;

-- 2) Drop existing policies
DROP POLICY IF EXISTS "Housekeeping staff can view their assignments" ON public.room_assignments;
DROP POLICY IF EXISTS "Managers and admins can create assignments" ON public.room_assignments;
DROP POLICY IF EXISTS "Managers and admins can delete assignments" ON public.room_assignments;

-- 3) Create new RLS policies to include housekeeping_manager
CREATE POLICY "Housekeeping staff can view their assignments"
ON public.room_assignments
FOR SELECT
USING (
  assigned_to = auth.uid()
  OR get_user_role(auth.uid()) IN ('housekeeping_manager','manager','admin','housekeeping')
  OR assigned_by = auth.uid()
);

CREATE POLICY "Managers and admins can create assignments"
ON public.room_assignments
FOR INSERT
WITH CHECK (
  get_user_role(auth.uid()) IN ('housekeeping_manager','manager','admin')
  AND assigned_by = auth.uid()
);

CREATE POLICY "Managers and admins can delete assignments"
ON public.room_assignments
FOR DELETE
USING (
  get_user_role(auth.uid()) IN ('housekeeping_manager','manager','admin')
);