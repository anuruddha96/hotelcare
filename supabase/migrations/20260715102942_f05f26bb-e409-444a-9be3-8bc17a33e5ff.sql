CREATE OR REPLACE FUNCTION public.get_assignable_staff_secure(requesting_user_role user_role)
 RETURNS TABLE(id uuid, full_name text, role user_role, nickname text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  current_user_hotel text;
  current_user_hotel_name text;
  current_user_org_slug text;
BEGIN
  SELECT p.assigned_hotel, p.organization_slug INTO current_user_hotel, current_user_org_slug
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF current_user_hotel IS NOT NULL THEN
    SELECT hc.hotel_name INTO current_user_hotel_name
    FROM public.hotel_configurations hc
    WHERE hc.hotel_id = current_user_hotel
    LIMIT 1;
  END IF;

  IF current_user_hotel IS NOT NULL AND current_user_org_slug IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.nickname
    FROM public.profiles p
    WHERE (p.role = 'housekeeping' OR p.acts_as_housekeeper = true)
      AND p.organization_slug = current_user_org_slug
      AND (
        p.assigned_hotel = current_user_hotel
        OR p.assigned_hotel = current_user_hotel_name
      )
      AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
  ELSE
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.nickname
    FROM public.profiles p
    WHERE (p.role = 'housekeeping' OR p.acts_as_housekeeper = true)
      AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
  END IF;
END;
$function$;