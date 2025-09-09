-- Fix RLS policies for attendance reports to allow HR and admins to see all data

-- Drop existing policies for staff_attendance
DROP POLICY IF EXISTS "HR and admins can view all attendance" ON public.staff_attendance;
DROP POLICY IF EXISTS "Users can view their own attendance" ON public.staff_attendance;

-- Create improved policies for staff_attendance
CREATE POLICY "Enhanced admin and HR access to attendance" 
ON public.staff_attendance FOR SELECT
USING (
  -- User can see their own records
  (user_id = auth.uid()) OR 
  -- HR, admin, manager can see all records
  (get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role]))
);

-- Also ensure the attendance summary function works for all roles
-- Update the function to be accessible by all authenticated users
CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  target_user_id uuid DEFAULT NULL, 
  start_date date DEFAULT (CURRENT_DATE - interval '30 days'), 
  end_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
  SELECT json_build_object(
    'total_days', COUNT(DISTINCT work_date),
    'total_hours', COALESCE(SUM(total_hours), 0),
    'avg_hours_per_day', COALESCE(AVG(total_hours), 0),
    'punctual_days', COUNT(*) FILTER (WHERE check_in_time::time <= '09:00:00'),
    'late_arrivals', COUNT(*) FILTER (WHERE check_in_time::time > '09:00:00'),
    'early_departures', COUNT(*) FILTER (WHERE check_out_time::time < '17:00:00' AND check_out_time IS NOT NULL)
  )
  FROM staff_attendance
  WHERE (
    (target_user_id IS NULL OR user_id = target_user_id) AND
    work_date BETWEEN start_date AND end_date AND
    check_out_time IS NOT NULL AND
    -- Apply the same security logic as RLS
    (
      user_id = auth.uid() OR 
      get_user_role(auth.uid()) = ANY(ARRAY['admin'::user_role, 'hr'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role])
    )
  );
$function$;