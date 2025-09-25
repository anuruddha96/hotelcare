-- Fix critical database relationship and function issues

-- Create the missing foreign key relationship between dnd_photos and rooms if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'dnd_photos_room_id_fkey'
    ) THEN
        ALTER TABLE public.dnd_photos 
        ADD CONSTRAINT dnd_photos_room_id_fkey 
        FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Fix the get_employees_by_hotel function to resolve ambiguous column reference
CREATE OR REPLACE FUNCTION public.get_employees_by_hotel()
RETURNS TABLE(id uuid, full_name text, role user_role, assigned_hotel text, email text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT p.assigned_hotel INTO current_user_hotel FROM public.profiles p WHERE p.id = auth.uid();
  
  -- Admin, HR, and top management can see all employees
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE p.role != 'admin'
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  -- Managers can only see employees from their hotel
  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE p.assigned_hotel = current_user_hotel
      AND p.role IN ('housekeeping', 'reception', 'maintenance', 'marketing', 'control_finance', 'front_office')
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  -- Regular users cannot see other employees
  RETURN;
END;
$function$;

-- Fix the get_attendance_records_hotel_filtered function to resolve ambiguous column reference
CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(target_user_id uuid DEFAULT NULL::uuid, start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), end_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(id uuid, user_id uuid, check_in_time timestamp with time zone, check_out_time timestamp with time zone, check_in_location jsonb, check_out_location jsonb, work_date date, total_hours numeric, break_duration integer, status text, notes text, full_name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT p.assigned_hotel INTO current_user_hotel FROM public.profiles p WHERE p.id = auth.uid();
  
  -- Admin, HR, and top management can see all records
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
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
      p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;
  
  -- Managers and housekeeping managers can only see their hotel's staff
  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
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
      p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
      AND p.assigned_hotel = current_user_hotel
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;
  
  -- Regular users can only see their own records
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
    p.role::text
  FROM public.staff_attendance sa
  JOIN public.profiles p ON sa.user_id = p.id
  WHERE sa.user_id = auth.uid()
    AND sa.work_date BETWEEN start_date AND end_date
  ORDER BY sa.work_date DESC, sa.check_in_time DESC;
END;
$function$;