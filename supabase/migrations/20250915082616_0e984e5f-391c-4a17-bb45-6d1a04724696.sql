-- Fix attendance visibility by creating a proper security definer function
-- that bypasses RLS for authorized users

-- First, drop the existing problematic function
DROP FUNCTION IF EXISTS public.get_attendance_summary_v2(uuid, date, date);

-- Create a new security definer function for fetching attendance records
CREATE OR REPLACE FUNCTION public.get_attendance_records_secure(
  target_user_id uuid DEFAULT NULL::uuid,
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  check_in_time timestamptz,
  check_out_time timestamptz,
  check_in_location jsonb,
  check_out_location jsonb,
  work_date date,
  total_hours numeric,
  break_duration integer,
  status text,
  notes text,
  full_name text,
  role user_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  current_user_role user_role;
BEGIN
  -- Get current user's role
  SELECT public.get_user_role(auth.uid()) INTO current_user_role;
  
  -- Check if user has permission to view attendance records
  IF current_user_role NOT IN ('admin', 'hr', 'manager', 'housekeeping_manager', 'top_management') THEN
    -- Non-admin users can only see their own records
    IF target_user_id IS NOT NULL AND target_user_id != auth.uid() THEN
      RETURN;
    END IF;
    target_user_id := auth.uid();
  END IF;
  
  RETURN QUERY
  SELECT 
    sa.id,
    sa.user_id,
    sa.check_in_time,
    sa.check_out_time,
    sa.check_in_location,
    sa.check_out_location,
    sa.work_date,
    sa.total_hours,
    sa.break_duration,
    sa.status,
    sa.notes,
    p.full_name,
    p.role
  FROM public.staff_attendance sa
  JOIN public.profiles p ON sa.user_id = p.id
  WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
    AND sa.work_date BETWEEN start_date AND end_date
  ORDER BY sa.work_date DESC, sa.check_in_time DESC;
END;
$$;

-- Create a new security definer function for attendance summary
CREATE OR REPLACE FUNCTION public.get_attendance_summary_secure(
  target_user_id uuid DEFAULT NULL::uuid,
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  current_user_role user_role;
  summary_data json;
BEGIN
  -- Get current user's role
  SELECT public.get_user_role(auth.uid()) INTO current_user_role;
  
  -- Check if user has permission to view attendance records
  IF current_user_role NOT IN ('admin', 'hr', 'manager', 'housekeeping_manager', 'top_management') THEN
    -- Non-admin users can only see their own records
    IF target_user_id IS NOT NULL AND target_user_id != auth.uid() THEN
      target_user_id := auth.uid();
    ELSE
      target_user_id := auth.uid();
    END IF;
  END IF;
  
  SELECT json_build_object(
    'total_days', COALESCE(COUNT(DISTINCT sa.work_date), 0),
    'total_hours', COALESCE(SUM(sa.total_hours), 0),
    'avg_hours_per_day', COALESCE(
      CASE 
        WHEN COUNT(DISTINCT sa.work_date) > 0 
        THEN SUM(sa.total_hours) / COUNT(DISTINCT sa.work_date)
        ELSE 0 
      END, 0
    ),
    'punctual_days', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time <= '09:00:00'), 0),
    'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time > '09:00:00'), 0),
    'early_departures', COALESCE(COUNT(*) FILTER (WHERE sa.check_out_time::time < '17:00:00' AND sa.check_out_time IS NOT NULL), 0)
  ) INTO summary_data
  FROM public.staff_attendance sa
  WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
    AND sa.work_date BETWEEN start_date AND end_date;
    
  RETURN summary_data;
END;
$$;