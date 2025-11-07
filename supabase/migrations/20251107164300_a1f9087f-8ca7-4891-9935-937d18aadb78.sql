-- Update get_assignable_staff_secure to filter by organization and hotel
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
  -- Get current user's assigned hotel and organization
  SELECT p.assigned_hotel, p.organization_slug INTO current_user_hotel, current_user_org_slug
  FROM public.profiles p 
  WHERE p.id = auth.uid();
  
  -- Get hotel name from hotel_id if needed
  IF current_user_hotel IS NOT NULL THEN
    SELECT hc.hotel_name INTO current_user_hotel_name
    FROM public.hotel_configurations hc
    WHERE hc.hotel_id = current_user_hotel
    LIMIT 1;
  END IF;
  
  -- Return housekeepers filtered by organization and hotel
  IF current_user_hotel IS NOT NULL AND current_user_org_slug IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.nickname
    FROM public.profiles p
    WHERE p.role = 'housekeeping'
      AND p.organization_slug = current_user_org_slug
      AND (
        p.assigned_hotel = current_user_hotel 
        OR p.assigned_hotel = current_user_hotel_name
      )
      AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
  ELSE
    -- If no hotel or org assigned, return all housekeepers (for super admin)
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.nickname
    FROM public.profiles p
    WHERE p.role = 'housekeeping'
      AND requesting_user_role IN ('manager', 'housekeeping_manager', 'admin');
  END IF;
END;
$function$;