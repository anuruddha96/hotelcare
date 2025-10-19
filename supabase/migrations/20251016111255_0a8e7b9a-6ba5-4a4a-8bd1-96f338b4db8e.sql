-- Fix RLS policy to allow users to see ALL their attendance records, including admin-created ones
DROP POLICY IF EXISTS "Admin_HR_attendance_access" ON staff_attendance;
DROP POLICY IF EXISTS "Users can insert their own attendance" ON staff_attendance;
DROP POLICY IF EXISTS "Admins can insert attendance for any user" ON staff_attendance;

-- Create comprehensive SELECT policy that allows users to see all their records
CREATE POLICY "Users can view all their own attendance records"
ON staff_attendance
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() OR
  get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role, 'top_management'::user_role])
);

-- Allow users to insert their own attendance
CREATE POLICY "Users can insert their own attendance"
ON staff_attendance
FOR INSERT
TO authenticated
WITH CHECK (
  organization_slug = get_user_organization_slug(auth.uid()) AND
  user_id = auth.uid()
);

-- Allow admins/managers to insert attendance for any user
CREATE POLICY "Admins can insert attendance for any user"
ON staff_attendance
FOR INSERT
TO authenticated
WITH CHECK (
  get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role])
);