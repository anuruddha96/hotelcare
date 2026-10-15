-- Replace opt-out "notify all property managers" with opt-in, top-management
-- selected recipients for each hotel. The original L1/L2 lists are preserved.
ALTER TABLE public.maintenance_escalation_settings
  ADD COLUMN IF NOT EXISTS creation_recipient_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE public.maintenance_escalation_settings
  ALTER COLUMN notify_property_staff SET DEFAULT false;

-- The old setting was an automatic broadcast toggle. Never carry it forward.
UPDATE public.maintenance_escalation_settings
   SET notify_property_staff = false
 WHERE notify_property_staff IS DISTINCT FROM false;

-- Only top-management can administer hotel email recipient settings.
-- Organization top management can configure all its venues; a hotel's
-- top-management manager is limited to their own property. Admin/manager
-- roles cannot access this configuration.
CREATE OR REPLACE FUNCTION public.can_manage_maintenance_escalation(
  p_organization_slug text, p_hotel text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.deleted_at IS NULL
      AND p.organization_slug = p_organization_slug
      AND p.role::text IN ('top_management', 'top_management_manager')
      AND p_hotel IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.hotel_configurations h
        JOIN public.organizations o ON o.id = h.organization_id
        WHERE o.slug = p_organization_slug AND h.is_active IS TRUE
          AND (h.hotel_id = p_hotel OR h.hotel_name = p_hotel)
      )
      AND (
        p.role::text = 'top_management'
        OR (
          p.role::text = 'top_management_manager'
          AND public.maintenance_hotel_matches(
            p.assigned_hotel, p_hotel, p_organization_slug
          )
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_maintenance_escalation(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_maintenance_escalation(text,text) TO authenticated;

-- Only managers/reception and designated top managers at this hotel
-- can be selected. Company-level top managers are also eligible.
-- Return inactive/placeholder email status for a clear admin warning;
-- recipients without a valid email cannot be selected or sent.
CREATE OR REPLACE FUNCTION public.get_maintenance_creation_candidates(p_hotel text)
RETURNS TABLE (
  id uuid,
  full_name text,
  role text,
  assigned_hotel text,
  email text,
  can_email boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id,coalesce(p.full_name,'Team member'),p.role::text,
    p.assigned_hotel,p.email,
    (
      p.email IS NOT NULL
      AND p.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      AND lower(split_part(p.email,'@',2)) !~ '[.](local|test|invalid|example)$'
    ) AS can_email
  FROM public.profiles caller
  JOIN public.profiles p ON p.organization_slug = caller.organization_slug
  WHERE caller.id = auth.uid()
    AND caller.deleted_at IS NULL
    AND public.can_manage_maintenance_escalation(caller.organization_slug,p_hotel)
    AND p.deleted_at IS NULL
    AND p.role::text IN (
      'manager','reception','reception_manager','maintenance_manager',
      'top_management','top_management_manager'
    )
    AND (
      p.role::text = 'top_management'
      OR public.maintenance_hotel_matches(
         p.assigned_hotel,p_hotel,caller.organization_slug
      )
    )
  ORDER BY p.role::text,p.full_name;
$$;
REVOKE ALL ON FUNCTION public.get_maintenance_creation_candidates(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_maintenance_creation_candidates(text) TO authenticated;
