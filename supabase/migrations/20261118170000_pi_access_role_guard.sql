-- Role boundary for Purchase Invoices. The underlying permission level can be
-- top_management_manager even when the person's effective job role is HR.
-- Keep both module navigation and database policies aligned. This gate is
-- consumed by purchase_invoices RLS, PI storage RLS, NAV reconciliation and
-- the pi_module_access RPC. Does not alter any existing financial records.
CREATE OR REPLACE FUNCTION public.pi_module_access_for(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      LEFT JOIN public.pi_module_settings s ON s.organization_slug = p.organization_slug
      LEFT JOIN public.finance_access fa ON fa.user_id = p.id AND fa.organization_slug = p.organization_slug
     WHERE p.id = _uid
       AND (
         coalesce(p.is_super_admin, false)
         OR public.effective_access_role(p.access_role, p.role::text) IN ('admin', 'top_management', 'controlling')
       )
       AND (
         -- Retain the original owner pilot exception only for authorized roles.
         lower(btrim(coalesce(p.nickname, ''))) = 'anu_000'
         OR (
           coalesce(s.module_enabled, false)
           AND (
             (fa.profile IS NOT NULL AND fa.profile <> 'none'::public.finance_profile)
             OR p.role::text = ANY (coalesce(s.allowed_roles, '{}'::text[]))
           )
         )
       )
  )
$$;
REVOKE ALL ON FUNCTION public.pi_module_access_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_module_access_for(uuid) TO service_role;
