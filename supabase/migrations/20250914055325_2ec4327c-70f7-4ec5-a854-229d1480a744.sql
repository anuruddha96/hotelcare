-- Fix RLS policy for staff_attendance to ensure admins and HR can see all records
DROP POLICY IF EXISTS "Enhanced admin and HR access to attendance" ON public.staff_attendance;

-- Create a more explicit policy for admin/HR access
CREATE POLICY "Admins and HR can view all attendance records" 
ON public.staff_attendance 
FOR SELECT 
USING (
  user_id = auth.uid() OR 
  get_user_role(auth.uid()) = ANY(ARRAY[
    'admin'::user_role, 
    'hr'::user_role, 
    'manager'::user_role, 
    'housekeeping_manager'::user_role, 
    'top_management'::user_role
  ])
);

-- Also update the attendance summary function to work with the new RLS
CREATE OR REPLACE FUNCTION public.get_attendance_summary_v2(
  target_user_id uuid DEFAULT NULL::uuid, 
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), 
  end_date date DEFAULT CURRENT_DATE
) 
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT json_build_object(
    'total_days', COALESCE(COUNT(DISTINCT public.staff_attendance.work_date), 0),
    'total_hours', COALESCE(SUM(public.staff_attendance.total_hours), 0),
    'avg_hours_per_day', COALESCE(
      CASE 
        WHEN COUNT(DISTINCT public.staff_attendance.work_date) > 0 
        THEN SUM(public.staff_attendance.total_hours) / COUNT(DISTINCT public.staff_attendance.work_date)
        ELSE 0 
      END, 0
    ),
    'punctual_days', COALESCE(COUNT(*) FILTER (WHERE public.staff_attendance.check_in_time::time <= '09:00:00'), 0),
    'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE public.staff_attendance.check_in_time::time > '09:00:00'), 0),
    'early_departures', COALESCE(COUNT(*) FILTER (WHERE public.staff_attendance.check_out_time::time < '17:00:00' AND public.staff_attendance.check_out_time IS NOT NULL), 0)
  )
  FROM public.staff_attendance
  WHERE (
    (target_user_id IS NULL OR public.staff_attendance.user_id = target_user_id) AND
    public.staff_attendance.work_date BETWEEN start_date AND end_date
  );
$function$;