-- Expose only the minimal identity needed by the maintenance worker UI.
-- The caller can see maintenance teammate ID/name only for their own tenant/property.
CREATE OR REPLACE FUNCTION public.get_maintenance_property_teammates()
RETURNS TABLE(id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT teammate.id, teammate.full_name
  FROM public.profiles caller
  JOIN public.profiles teammate
    ON teammate.organization_slug = caller.organization_slug
   AND teammate.deleted_at IS NULL
   AND teammate.role::text IN ('maintenance', 'maintenance_manager')
   AND teammate.assigned_hotel IS NOT NULL
   AND public.get_hotel_name_from_id(teammate.assigned_hotel)
       = public.get_hotel_name_from_id(caller.assigned_hotel)
  WHERE caller.id = auth.uid()
    AND caller.deleted_at IS NULL
    AND caller.role::text IN ('maintenance', 'maintenance_manager')
    AND caller.assigned_hotel IS NOT NULL
  ORDER BY teammate.full_name;
$function$;

REVOKE ALL ON FUNCTION public.get_maintenance_property_teammates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_maintenance_property_teammates() TO authenticated;
