DROP POLICY IF EXISTS audit_select_admin_topmgmt ON public.rate_change_audit;
CREATE POLICY audit_select_admin_topmgmt ON public.rate_change_audit
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.role = ANY (ARRAY['admin'::user_role,'top_management'::user_role,'top_management_manager'::user_role])
    AND p.organization_slug = rate_change_audit.organization_slug
));

CREATE INDEX IF NOT EXISTS rate_change_audit_hotel_performed_idx
  ON public.rate_change_audit (hotel_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS rate_change_audit_stay_date_idx
  ON public.rate_change_audit (hotel_id, stay_date);