DROP POLICY IF EXISTS pi_full_admin_top_ctrl_insert ON public.purchase_invoices;
CREATE POLICY pi_full_admin_top_ctrl_insert ON public.purchase_invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance'])
    AND organization_slug = pi_user_org()
    AND uploaded_by = auth.uid()
  );