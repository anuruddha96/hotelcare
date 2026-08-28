CREATE OR REPLACE FUNCTION public.user_can_access_hotel(_uid uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.hotel_configurations hc
      ON hc.hotel_id = _hotel_id
      OR hc.hotel_name = _hotel_id
      OR public.get_hotel_name_from_id(hc.hotel_id) = _hotel_id
    LEFT JOIN public.organizations o ON o.id = hc.organization_id
    WHERE p.id = _uid
      AND (
        COALESCE(p.is_super_admin, false)
        OR (
          p.organization_slug = o.slug
          AND (
            p.role IN ('admin', 'top_management', 'top_management_manager')
            OR p.assigned_hotel = hc.hotel_id
            OR p.assigned_hotel = hc.hotel_name
            OR public.get_hotel_name_from_id(p.assigned_hotel) = hc.hotel_name
            OR EXISTS (
              SELECT 1
              FROM public.user_property_scopes ups
              JOIN public.venues v ON v.id = ups.venue_id
              WHERE ups.user_id = p.id
                AND ups.organization_slug = p.organization_slug
                AND v.organization_slug = p.organization_slug
                AND v.hotel_id = hc.hotel_id
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_hotel(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_hotel(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_hotel(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_revenue_published_payload(_hotel_id text)
RETURNS TABLE(
  sync_completed_at timestamptz,
  sync_completed_by_name text,
  horizon_from date,
  horizon_to date,
  payload jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.sync_completed_at, p.sync_completed_by_name, p.horizon_from, p.horizon_to, p.payload
  FROM public.revenue_published_payloads p
  WHERE p.hotel_id = _hotel_id
    AND public.user_can_access_hotel(auth.uid(), p.hotel_id)
    AND EXISTS (
      SELECT 1
      FROM public.profiles profile
      WHERE profile.id = auth.uid()
        AND (
          COALESCE(profile.is_super_admin, false)
          OR profile.organization_slug = p.organization_slug
        )
    )
$$;

REVOKE ALL ON FUNCTION public.get_revenue_published_payload(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_revenue_published_payload(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_revenue_published_payload(text) TO service_role;