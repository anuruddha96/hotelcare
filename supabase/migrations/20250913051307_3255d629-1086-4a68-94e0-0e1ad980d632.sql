-- Fix completion_photos column in room_assignments table (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'room_assignments' 
        AND column_name = 'completion_photos'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.room_assignments 
        ADD COLUMN completion_photos text[] DEFAULT '{}';
    END IF;
END $$;

-- Update attendance reports RLS to fix visibility for admins and HR
DROP POLICY IF EXISTS "Enhanced admin and HR access to attendance" ON public.staff_attendance;

CREATE POLICY "Enhanced admin and HR access to attendance" ON public.staff_attendance
FOR SELECT USING (
  (user_id = auth.uid()) OR 
  (get_user_role(auth.uid()) = ANY(ARRAY['admin', 'hr', 'manager', 'housekeeping_manager', 'top_management']))
);

-- Ensure attendance records are visible to all authorized users regardless of hotel assignment
CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  target_user_id uuid DEFAULT NULL,
  start_date date DEFAULT (CURRENT_DATE - INTERVAL '30 days'),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT json_build_object(
    'total_days', COUNT(DISTINCT public.staff_attendance.work_date),
    'total_hours', COALESCE(SUM(public.staff_attendance.total_hours), 0),
    'avg_hours_per_day', COALESCE(AVG(public.staff_attendance.total_hours), 0),
    'punctual_days', COUNT(*) FILTER (WHERE public.staff_attendance.check_in_time::time <= '09:00:00'),
    'late_arrivals', COUNT(*) FILTER (WHERE public.staff_attendance.check_in_time::time > '09:00:00'),
    'early_departures', COUNT(*) FILTER (WHERE public.staff_attendance.check_out_time::time < '17:00:00' AND public.staff_attendance.check_out_time IS NOT NULL)
  )
  FROM public.staff_attendance
  WHERE (
    (target_user_id IS NULL OR public.staff_attendance.user_id = target_user_id) AND
    public.staff_attendance.work_date BETWEEN start_date AND end_date AND
    public.staff_attendance.check_out_time IS NOT NULL AND
    -- Apply the same security logic as RLS but allow HR/admin to see all
    (
      public.staff_attendance.user_id = auth.uid() OR 
      public.get_user_role(auth.uid()) = ANY(ARRAY['admin', 'hr', 'manager', 'housekeeping_manager', 'top_management'])
    )
  );
$$;