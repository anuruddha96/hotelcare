CREATE OR REPLACE FUNCTION public.get_hotel_housekeeping_photo_requirements(
  p_hotel_configuration_id uuid
)
RETURNS TABLE(category text, sort_order integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  caller_role text;
  config_org text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '42501';
  END IF;

  caller_role := public.get_user_role(auth.uid())::text;

  SELECT o.slug
    INTO config_org
    FROM public.hotel_configurations hc
    JOIN public.organizations o ON o.id = hc.organization_id
   WHERE hc.id = p_hotel_configuration_id;

  IF config_org IS NULL THEN
    RAISE EXCEPTION 'Hotel configuration not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_super_admin(auth.uid()) THEN
    IF caller_role NOT IN ('admin','top_management','top_management_manager') THEN
      RAISE EXCEPTION 'Only top managers can view photo requirement settings' USING ERRCODE = '42501';
    END IF;
    IF config_org IS DISTINCT FROM public.get_user_organization_slug(auth.uid()) THEN
      RAISE EXCEPTION 'Hotel is outside your organization' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT hpr.category, hpr.sort_order
    FROM public.housekeeping_photo_requirements hpr
   WHERE hpr.hotel_configuration_id = p_hotel_configuration_id
   ORDER BY hpr.sort_order, hpr.category;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_hotel_housekeeping_photo_requirements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hotel_housekeeping_photo_requirements(uuid) TO authenticated;
