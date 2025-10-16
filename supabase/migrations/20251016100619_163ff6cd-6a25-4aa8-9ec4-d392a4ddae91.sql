-- Allow admins to insert attendance records for any user
CREATE POLICY "Admins can insert attendance for any user"
ON public.staff_attendance
FOR INSERT
TO authenticated
WITH CHECK (
  get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role])
);