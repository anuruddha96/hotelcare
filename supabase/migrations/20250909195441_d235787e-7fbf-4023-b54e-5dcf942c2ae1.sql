-- Fix all functions with mutable search_path security issue
-- Update all functions to have SET search_path TO ''

-- Fix get_user_access_config
CREATE OR REPLACE FUNCTION public.get_user_access_config(user_role public.user_role)
 RETURNS TABLE(department text, access_scope text, can_manage_all boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT 
    dac.department,
    dac.access_scope,
    dac.can_manage_all
  FROM public.department_access_config dac
  WHERE dac.role = user_role;
$function$;

-- Fix get_hotel_name_from_id  
CREATE OR REPLACE FUNCTION public.get_hotel_name_from_id(hotel_id text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE 
    WHEN hotel_id = 'memories-budapest' THEN 'Hotel Memories Budapest'
    WHEN hotel_id = 'mika-downtown' THEN 'Hotel Mika Downtown'
    WHEN hotel_id = 'ottofiori' THEN 'Hotel Ottofiori'
    WHEN hotel_id = 'gozsdu-court' THEN 'Gozsdu Court Budapest'
    ELSE hotel_id
  END;
$function$;

-- Fix get_housekeeping_summary
CREATE OR REPLACE FUNCTION public.get_housekeeping_summary(user_id uuid, target_date date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT json_build_object(
    'total_assigned', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date
    ),
    'completed', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'completed'
    ),
    'in_progress', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'in_progress'
    ),
    'pending', (
      SELECT COUNT(*) FROM public.room_assignments 
      WHERE assigned_to = user_id 
      AND assignment_date = target_date 
      AND status = 'assigned'
    )
  );
$function$;

-- Fix get_housekeeper_performance_stats
CREATE OR REPLACE FUNCTION public.get_housekeeper_performance_stats(target_housekeeper_id uuid DEFAULT NULL::uuid, days_back integer DEFAULT 30)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT json_build_object(
    'avg_duration_minutes', COALESCE(AVG(actual_duration_minutes), 0),
    'avg_efficiency_score', COALESCE(AVG(efficiency_score), 100),
    'total_completed', COUNT(*),
    'best_time_minutes', COALESCE(MIN(actual_duration_minutes), 0),
    'total_rooms_today', (
      SELECT COUNT(*) FROM public.housekeeping_performance 
      WHERE housekeeper_id = COALESCE(target_housekeeper_id, housekeeper_id)
      AND assignment_date = CURRENT_DATE
    )
  )
  FROM public.housekeeping_performance 
  WHERE (target_housekeeper_id IS NULL OR housekeeper_id = target_housekeeper_id)
  AND assignment_date >= CURRENT_DATE - INTERVAL '1 day' * days_back;
$function$;

-- Fix get_housekeeping_leaderboard
CREATE OR REPLACE FUNCTION public.get_housekeeping_leaderboard(days_back integer DEFAULT 7)
 RETURNS TABLE(housekeeper_id uuid, full_name text, avg_duration_minutes numeric, avg_efficiency_score numeric, total_completed bigint, rank_position bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT 
    hp.housekeeper_id,
    p.full_name,
    ROUND(AVG(hp.actual_duration_minutes), 1) as avg_duration_minutes,
    ROUND(AVG(hp.efficiency_score), 1) as avg_efficiency_score,
    COUNT(*) as total_completed,
    RANK() OVER (ORDER BY AVG(hp.efficiency_score) DESC, AVG(hp.actual_duration_minutes) ASC) as rank_position
  FROM public.housekeeping_performance hp
  JOIN public.profiles p ON hp.housekeeper_id = p.id
  WHERE hp.assignment_date >= CURRENT_DATE - INTERVAL '1 day' * days_back
  AND p.role = 'housekeeping'
  GROUP BY hp.housekeeper_id, p.full_name
  HAVING COUNT(*) >= 1
  ORDER BY rank_position;
$function$;

-- Fix get_assignable_staff
CREATE OR REPLACE FUNCTION public.get_assignable_staff(requesting_user_role public.user_role)
 RETURNS TABLE(id uuid, full_name text, role public.user_role, email text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.id, p.full_name, p.role, p.email
  FROM public.profiles p
  WHERE 
    -- Only return operational staff that can be assigned tickets
    p.role IN ('housekeeping', 'maintenance', 'reception', 'front_office', 'marketing', 'control_finance') AND
    -- Only allow HR and admins to get email addresses
    requesting_user_role IN ('hr', 'admin');
$function$;

-- Fix get_assignable_staff_secure
CREATE OR REPLACE FUNCTION public.get_assignable_staff_secure(requesting_user_role public.user_role)
 RETURNS TABLE(id uuid, full_name text, role public.user_role, nickname text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.id, p.full_name, p.role, p.nickname
  FROM public.profiles p
  WHERE p.role = 'housekeeping'
    AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
$function$;

-- Fix get_email_by_nickname
CREATE OR REPLACE FUNCTION public.get_email_by_nickname(p_nickname text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT email
  FROM public.profiles
  WHERE LOWER(nickname) = LOWER(p_nickname)
  LIMIT 1;
$function$;

-- Fix get_email_case_insensitive
CREATE OR REPLACE FUNCTION public.get_email_case_insensitive(p_email text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT email
  FROM public.profiles
  WHERE LOWER(email) = LOWER(p_email)
  LIMIT 1;
$function$;