-- Fix get_employees_by_hotel function to include created_at field
CREATE OR REPLACE FUNCTION public.get_employees_by_hotel()
 RETURNS TABLE(id uuid, full_name text, role user_role, assigned_hotel text, email text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT assigned_hotel INTO current_user_hotel FROM public.profiles WHERE id = auth.uid();
  
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