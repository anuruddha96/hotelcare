-- The browser must never infer organization ownership from an unscoped hotel-list
-- RPC. Resolve the active caller's organization and active hotels together,
-- even when direct SELECT on organizations is denied to managers by RLS.
-- No client-supplied user ID, organization ID, or elevated role is accepted.
CREATE OR REPLACE FUNCTION public.get_authenticated_tenant_context(_organization_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'organization', to_jsonb(o),
    'hotels', COALESCE((
      SELECT jsonb_agg(to_jsonb(h) ORDER BY h.hotel_name, h.hotel_id)
      FROM public.hotel_configurations h
      WHERE h.organization_id = o.id
        AND h.is_active = true
    ), '[]'::jsonb)
  )
  FROM public.profiles caller
  JOIN public.organizations o ON o.slug = caller.organization_slug
  WHERE caller.id = auth.uid()
    AND caller.deleted_at IS NULL
    AND caller.organization_slug IS NOT NULL
    AND caller.organization_slug = _organization_slug
    AND o.is_active = true;
$function$;

REVOKE ALL ON FUNCTION public.get_authenticated_tenant_context(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_authenticated_tenant_context(text) TO authenticated;

COMMENT ON FUNCTION public.get_authenticated_tenant_context(text) IS
  'Return only the authenticated active employee organization and active hotels; secure manager fallback (#346).';
