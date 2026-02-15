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
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT p.assigned_hotel INTO current_user_hotel FROM public.profiles p WHERE p.id = auth.uid();
  
  IF current_user_hotel IS NOT NULL THEN
    SELECT public.get_hotel_name_from_id(current_user_hotel) INTO current_user_hotel_name;
  END IF;
  
  IF current_user_hotel IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE (
      p.assigned_hotel = current_user_hotel 
      OR p.assigned_hotel = current_user_hotel_name
    )
    AND p.role IN ('housekeeping', 'reception', 'maintenance', 'marketing', 'control_finance', 'front_office', 'manager', 'housekeeping_manager')
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  IF current_user_role IN ('admin', 'hr', 'top_management') THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE p.role != 'admin'
    ORDER BY p.full_name;
    RETURN;
  END IF;
  
  RETURN;
END;
$function$;