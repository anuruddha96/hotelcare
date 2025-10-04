-- Fix get_assignable_staff_secure to properly filter by assigned hotel
CREATE OR REPLACE FUNCTION public.get_assignable_staff_secure(requesting_user_role user_role)
 RETURNS TABLE(id uuid, full_name text, role user_role, nickname text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_hotel text;
  current_user_hotel_name text;
BEGIN
  -- Get current user's assigned hotel
  SELECT p.assigned_hotel INTO current_user_hotel 
  FROM public.profiles p 
  WHERE p.id = auth.uid();
  
  -- Get hotel name from hotel_id if needed
  IF current_user_hotel IS NOT NULL THEN
    SELECT public.get_hotel_name_from_id(current_user_hotel) INTO current_user_hotel_name;
  END IF;
  
  -- Return housekeepers filtered by hotel
  IF current_user_hotel IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.nickname
    FROM public.profiles p
    WHERE p.role = 'housekeeping'
      AND (
        p.assigned_hotel = current_user_hotel 
        OR p.assigned_hotel = current_user_hotel_name
      )
      AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
  ELSE
    -- If no hotel assigned, return all housekeepers (for super admin with no specific hotel)
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.nickname
    FROM public.profiles p
    WHERE p.role = 'housekeeping'
      AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
  END IF;
END;
$function$;

-- Fix get_employees_by_hotel to properly filter by assigned hotel
CREATE OR REPLACE FUNCTION public.get_employees_by_hotel()
 RETURNS TABLE(id uuid, full_name text, role user_role, assigned_hotel text, email text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
  current_user_hotel_name text;
BEGIN
  -- Get current user's role and hotel
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT p.assigned_hotel INTO current_user_hotel FROM public.profiles p WHERE p.id = auth.uid();
  
  -- Get hotel name from hotel_id if needed
  IF current_user_hotel IS NOT NULL THEN
    SELECT public.get_hotel_name_from_id(current_user_hotel) INTO current_user_hotel_name;
  END IF;
  
  -- If user has a specific hotel assigned, filter by that hotel
  IF current_user_hotel IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE (
      p.assigned_hotel = current_user_hotel 
      OR p.assigned_hotel = current_user_hotel_name
    )
    AND p.role IN ('housekeeping', 'reception', 'maintenance', 'marketing', 'control_finance', 'front_office')
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  -- If no hotel assigned (e.g., super admin viewing all), show all employees
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE p.role != 'admin'
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  -- Regular users cannot see other employees
  RETURN;
END;
$function$;