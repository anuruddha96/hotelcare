CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(
  target_user_id uuid DEFAULT NULL::uuid, 
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), 
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  id uuid, user_id uuid, check_in_time timestamp with time zone, 
  check_out_time timestamp with time zone, check_in_location jsonb, 
  check_out_location jsonb, work_date date, total_hours numeric, 
  break_duration integer, status text, notes text, full_name text, role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
  resolved_hotel_id text;
  resolved_hotel_name text;
BEGIN
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT p.assigned_hotel INTO current_user_hotel FROM public.profiles p WHERE p.id = auth.uid();
  
  -- Admin, HR, and top management can see all records
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
    RETURN QUERY
    SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
      sa.check_in_location, sa.check_out_location, sa.work_date,
      sa.total_hours, sa.break_duration, sa.status, sa.notes,
      p.full_name, p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;
  
  -- Managers: resolve hotel via hotel_configurations for proper matching
  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
    -- Resolve hotel_id and hotel_name from hotel_configurations
    SELECT hc.hotel_id, hc.hotel_name 
    INTO resolved_hotel_id, resolved_hotel_name
    FROM public.hotel_configurations hc
    WHERE hc.hotel_id = current_user_hotel OR hc.hotel_name = current_user_hotel
    LIMIT 1;
    
    RETURN QUERY
    SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
      sa.check_in_location, sa.check_out_location, sa.work_date,
      sa.total_hours, sa.break_duration, sa.status, sa.notes,
      p.full_name, p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
      AND (
        p.assigned_hotel = current_user_hotel
        OR p.assigned_hotel = resolved_hotel_id
        OR p.assigned_hotel = resolved_hotel_name
      )
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;
  
  -- Regular users can only see their own records
  RETURN QUERY
  SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
    sa.check_in_location, sa.check_out_location, sa.work_date,
    sa.total_hours, sa.break_duration, sa.status, sa.notes,
    p.full_name, p.role::text
  FROM public.staff_attendance sa
  JOIN public.profiles p ON sa.user_id = p.id
  WHERE sa.user_id = auth.uid()
    AND sa.work_date BETWEEN start_date AND end_date
  ORDER BY sa.work_date DESC, sa.check_in_time DESC;
END;
$function$;