-- Fix security warning: Function search path mutable for get_attendance_summary
CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  target_user_id uuid DEFAULT NULL, 
  start_date date DEFAULT (CURRENT_DATE - interval '30 days'), 
  end_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
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
    -- Apply the same security logic as RLS
    (
      public.staff_attendance.user_id = auth.uid() OR 
      public.get_user_role(auth.uid()) = ANY(ARRAY['admin'::public.user_role, 'hr'::public.user_role, 'manager'::public.user_role, 'housekeeping_manager'::public.user_role])
    )
  );
$function$;