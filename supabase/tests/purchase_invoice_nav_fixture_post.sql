-- Purchase-invoice policy state from migrations that also touch unrelated
-- tables (20260601111117, 20260808151911); only their invoice parts are replayed.
DROP POLICY IF EXISTS pi_full_admin_top_ctrl_select ON public.purchase_invoices;
CREATE POLICY pi_full_admin_top_ctrl_select ON public.purchase_invoices FOR SELECT
USING ((public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance']))
       AND (organization_slug = public.pi_user_org()));
DROP POLICY IF EXISTS pi_full_admin_top_ctrl_update ON public.purchase_invoices;
CREATE POLICY pi_full_admin_top_ctrl_update ON public.purchase_invoices FOR UPDATE
USING ((public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance']))
       AND (organization_slug = public.pi_user_org()));
DROP POLICY IF EXISTS pi_full_admin_delete ON public.purchase_invoices;
CREATE POLICY pi_full_admin_delete ON public.purchase_invoices FOR DELETE
USING ((public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager']))
       AND (organization_slug = public.pi_user_org()));

DROP POLICY IF EXISTS pi_items_all ON public.purchase_invoice_items;
CREATE POLICY pi_items_all ON public.purchase_invoice_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = purchase_invoice_items.invoice_id
                 AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = purchase_invoice_items.invoice_id
                 AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())));
DROP POLICY IF EXISTS pi_vat_all ON public.purchase_invoice_vat_lines;
CREATE POLICY pi_vat_all ON public.purchase_invoice_vat_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = purchase_invoice_vat_lines.invoice_id
                 AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = purchase_invoice_vat_lines.invoice_id
                 AND (public.pi_user_role() = 'admin' OR i.organization_slug = public.pi_user_org())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoices, public.purchase_invoice_vat_lines,
  public.purchase_invoice_items TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
