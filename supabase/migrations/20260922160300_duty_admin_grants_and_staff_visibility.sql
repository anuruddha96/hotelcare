-- Only authenticated managers with organization-level administration authority
-- may enumerate duty grants. A line manager cannot escalate an employee's
-- property membership through a client-side dropdown.
CREATE OR REPLACE FUNCTION public.list_company_property_duty_grants()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', employee.id,
    'full_name', employee.full_name,
    'role', employee.role::text,
    'hotel_configuration_id', h.id,
    'hotel_name', h.hotel_name,
    'can_manage', grant_row.can_manage,
    'granted_at', grant_row.granted_at
  ) ORDER BY employee.full_name, h.hotel_name), '[]'::jsonb)
  FROM public.profiles caller
  JOIN public.organizations o ON o.slug = caller.organization_slug AND o.is_active = true
  JOIN public.property_duty_grants grant_row ON grant_row.organization_id = o.id
    AND grant_row.revoked_at IS NULL
  JOIN public.profiles employee ON employee.id = grant_row.user_id
    AND employee.organization_slug = o.slug AND employee.deleted_at IS NULL
  JOIN public.hotel_configurations h ON h.id = grant_row.hotel_configuration_id
    AND h.organization_id = o.id
  WHERE caller.id = auth.uid() AND caller.deleted_at IS NULL
    AND caller.role::text IN ('admin','top_management','top_management_manager');
$fn$;
REVOKE ALL ON FUNCTION public.list_company_property_duty_grants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_company_property_duty_grants() TO authenticated;

-- Existing auto-assignment picks permanent-home attendance only. Prefer a
-- real, expiring duty session at the ticket's own organization/property;
-- fallback to a checked-in maintenance employee at their home venue.
CREATE OR REPLACE FUNCTION public.pick_active_maintenance_staff(
  _hotel text, _organization_slug text
) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE selected_id uuid;
BEGIN
  SELECT p.id INTO selected_id
  FROM public.profiles p
  JOIN public.organizations o ON o.slug = p.organization_slug AND o.is_active = true
  JOIN public.property_duty_sessions s ON s.user_id = p.id
    AND s.organization_id = o.id AND s.ended_at IS NULL AND s.expires_at > now()
  JOIN public.property_duty_grants g ON g.user_id = p.id
    AND g.organization_id = o.id AND g.hotel_configuration_id = s.hotel_configuration_id
    AND g.revoked_at IS NULL
  JOIN public.hotel_configurations h ON h.id = s.hotel_configuration_id
    AND h.organization_id = o.id AND h.is_active = true
  WHERE p.organization_slug = _organization_slug AND p.role::text = 'maintenance'
    AND p.deleted_at IS NULL
    AND public.maintenance_hotel_matches(h.hotel_id, _hotel, _organization_slug)
  ORDER BY (
    SELECT count(*) FROM public.tickets t
    WHERE t.assigned_to = p.id AND t.department = 'maintenance'
      AND t.status <> 'completed'::public.ticket_status
  ), s.started_at, p.id
  LIMIT 1;
  IF selected_id IS NOT NULL THEN RETURN selected_id; END IF;

  SELECT p.id INTO selected_id
  FROM public.profiles p
  JOIN public.staff_attendance a ON a.user_id = p.id
    AND a.work_date = (now() AT TIME ZONE 'Europe/Budapest')::date
    AND a.status = 'checked_in'
  WHERE p.organization_slug = _organization_slug AND p.role::text = 'maintenance'
    AND p.deleted_at IS NULL
    AND public.maintenance_hotel_matches(p.assigned_hotel, _hotel, _organization_slug)
    AND NOT EXISTS (
      SELECT 1 FROM public.property_duty_sessions s
      JOIN public.property_duty_grants g ON g.user_id = p.id
        AND g.hotel_configuration_id = s.hotel_configuration_id
        AND g.organization_id = s.organization_id AND g.revoked_at IS NULL
      WHERE s.user_id = p.id AND s.ended_at IS NULL AND s.expires_at > now()
    )
  ORDER BY (
    SELECT count(*) FROM public.tickets t
    WHERE t.assigned_to = p.id AND t.department = 'maintenance'
      AND t.status <> 'completed'::public.ticket_status
  ), a.check_in_time NULLS LAST, p.id
  LIMIT 1;
  RETURN selected_id;
END;
$fn$;
-- This is a trigger helper, not a public employee directory.
REVOKE ALL ON FUNCTION public.pick_active_maintenance_staff(text,text) FROM PUBLIC, anon, authenticated;
