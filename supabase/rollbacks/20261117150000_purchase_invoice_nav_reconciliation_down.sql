-- Rollback for 20261117150000_purchase_invoice_nav_reconciliation.sql
--
-- Run manually in a reviewed maintenance window (NOT an automatic migration).
-- Principles (see docs/HOUSEKEEPING_TENANT_GUARD_ROLLOUT.md "Rollback principles"):
--  * never reintroduce cross-organization reads: the organization-scoped storage
--    policies stay; only the module gate inside them is removed;
--  * never delete historical work: NAV records, provenance, follow-ups,
--    reconciliation events and the deletion archive are preserved;
--  * stop every automated NAV call first.

BEGIN;

-- 1. Stop automation and disable every NAV connection.
DO $$
DECLARE job record;
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    FOR job IN SELECT jobid FROM cron.job WHERE jobname IN ('hotelcare-nav-sync','hotelcare-pi-ocr-recovery','hotelcare-pi-daily-summary') LOOP
      PERFORM cron.unschedule(job.jobid);
    END LOOP;
  END IF;
END $$;
UPDATE public.pi_nav_connections SET enabled = false, status = 'disabled' WHERE enabled;

-- 2. Remove the new guards and the module gate.
DROP TRIGGER IF EXISTS trg_pi_guard_update ON public.purchase_invoices;
DROP TRIGGER IF EXISTS trg_pi_guard_insert ON public.purchase_invoices;
DROP TRIGGER IF EXISTS trg_pi_guard_delete ON public.purchase_invoices;
DROP TRIGGER IF EXISTS trg_pi_enqueue_job ON public.purchase_invoices;
DROP TRIGGER IF EXISTS trg_pi_guard_followup ON public.pi_missing_document_followups;
DROP POLICY IF EXISTS pi_module_gate ON public.purchase_invoices;

-- 3. Storage: keep organization scoping, drop the module dependency.
DROP POLICY IF EXISTS pi_storage_read_scoped ON storage.objects;
DROP POLICY IF EXISTS pi_storage_insert_scoped ON storage.objects;
DROP POLICY IF EXISTS pi_storage_delete_scoped ON storage.objects;
CREATE POLICY pi_storage_read_scoped ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'purchase-invoices' AND (storage.foldername(name))[1] = public.pi_user_org()
       AND EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.file_path = objects.name));
CREATE POLICY pi_storage_insert_scoped ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'purchase-invoices' AND (storage.foldername(name))[1] = public.pi_user_org()
            AND public.pi_user_role() IN ('admin','top_management','top_management_manager','control_finance','back_office','reception','front_office'));
CREATE POLICY pi_storage_delete_scoped ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'purchase-invoices' AND (storage.foldername(name))[1] = public.pi_user_org()
       AND public.pi_user_role() IN ('admin','top_management','top_management_manager'));

-- 4. Legal entities: restore the previous write policy.
DROP POLICY IF EXISTS ibc_admin_insert ON public.invoice_buyer_companies;
DROP POLICY IF EXISTS ibc_admin_update ON public.invoice_buyer_companies;
DROP POLICY IF EXISTS ibc_admin_delete ON public.invoice_buyer_companies;
DROP POLICY IF EXISTS "Admins manage buyer companies" ON public.invoice_buyer_companies;
CREATE POLICY "Admins manage buyer companies" ON public.invoice_buyer_companies FOR ALL TO authenticated
  USING (organization_slug = public.pi_user_org()
         AND public.pi_user_role() IN ('admin','top_management','top_management_manager','control_finance','back_office'))
  WITH CHECK (organization_slug = public.pi_user_org()
         AND public.pi_user_role() IN ('admin','top_management','top_management_manager','control_finance','back_office'));

-- 5. Restore the previous audit trigger body (20260825171630).
CREATE OR REPLACE FUNCTION public.pi_audit_invoice_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, notes)
    VALUES (NEW.id, NEW.organization_slug, coalesce(actor, NEW.uploaded_by), 'uploaded', NEW.file_path);
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'extraction_status', 'status', OLD.status, NEW.status);
  END IF;
  IF NEW.review_status IS DISTINCT FROM OLD.review_status THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value, notes)
    VALUES (NEW.id, NEW.organization_slug, actor, 'review_' || NEW.review_status, 'review_status', OLD.review_status, NEW.review_status, NEW.reviewer_notes);
  END IF;
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value, notes)
    VALUES (NEW.id, NEW.organization_slug, actor, 'approval_' || NEW.approval_status, 'approval_status', OLD.approval_status, NEW.approval_status, NEW.rejection_reason);
  END IF;
  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'edited', 'total_amount', OLD.total_amount::text, NEW.total_amount::text);
  END IF;
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'edited', 'invoice_number', OLD.invoice_number, NEW.invoice_number);
  END IF;
  IF NEW.buyer_company_id IS DISTINCT FROM OLD.buyer_company_id THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'edited', 'buyer_company_id', OLD.buyer_company_id::text, NEW.buyer_company_id::text);
  END IF;
  IF NEW.cost_centre_id IS DISTINCT FROM OLD.cost_centre_id THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'edited', 'cost_centre_id', OLD.cost_centre_id::text, NEW.cost_centre_id::text);
  END IF;
  IF NEW.duplicate_status IS DISTINCT FROM OLD.duplicate_status THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'duplicate_decision', 'duplicate_status', OLD.duplicate_status, NEW.duplicate_status);
  END IF;
  RETURN NEW;
END $$;

-- 6. file_path becomes mandatory again only when no historical import lacks a file.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.purchase_invoices WHERE file_path IS NULL) THEN
    ALTER TABLE public.purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_file_required;
    ALTER TABLE public.purchase_invoices ALTER COLUMN file_path SET NOT NULL;
  ELSE
    RAISE NOTICE 'Historical imports without files exist; file_path stays nullable (constraint kept)';
  END IF;
END $$;

COMMIT;

-- Optional, DESTRUCTIVE cleanup — only after exporting the data and with sign-off:
-- DROP TABLE public.pi_missing_document_notes, public.pi_missing_document_followups,
--   public.pi_invoice_field_provenance, public.pi_reconciliation_events, public.pi_nav_sync_events,
--   public.pi_nav_sync_runs, public.pi_processing_jobs, public.pi_daily_summary_log, public.pi_reconcile_state;
-- ALTER TABLE public.purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_nav_invoice_fk;
-- DROP TABLE public.pi_nav_invoices, public.pi_nav_connection_secrets, public.pi_nav_connections;
