-- Per-user interface preferences (e.g. the revenue calendar zoom level),
-- stored on the server so the view follows the person across devices.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Let revenue users close out a "landed on a different price" flag once they
-- have checked Previo. The update is limited to rows in their own hotel and
-- organization.
DROP POLICY IF EXISTS audit_resolve_revenue_hotel_access ON public.rate_change_audit;
CREATE POLICY audit_resolve_revenue_hotel_access
ON public.rate_change_audit
FOR UPDATE
TO authenticated
USING (
  public.is_revenue_user(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.organization_slug = rate_change_audit.organization_slug)
)
WITH CHECK (
  public.is_revenue_user(auth.uid())
  AND public.user_can_access_hotel(auth.uid(), hotel_id)
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.organization_slug = rate_change_audit.organization_slug)
);

GRANT UPDATE ON public.rate_change_audit TO authenticated;