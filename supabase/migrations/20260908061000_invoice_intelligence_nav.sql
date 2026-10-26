-- Invoice Intelligence v3 + NAV reconciliation foundation
-- Additive migration: keeps the current purchase invoice workflow intact while
-- adding machine-verifiable OCR controls and a normalized NAV matching layer.

ALTER TABLE IF EXISTS public.purchase_invoices
  ADD COLUMN IF NOT EXISTS document_hash text,
  ADD COLUMN IF NOT EXISTS ocr_version text,
  ADD COLUMN IF NOT EXISTS amount_confidence numeric,
  ADD COLUMN IF NOT EXISTS amount_resolution_method text,
  ADD COLUMN IF NOT EXISTS amount_balance_delta numeric,
  ADD COLUMN IF NOT EXISTS amount_verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_currency text,
  ADD COLUMN IF NOT EXISTS source_total_amount numeric,
  ADD COLUMN IF NOT EXISTS source_net_amount numeric,
  ADD COLUMN IF NOT EXISTS source_vat_amount numeric,
  ADD COLUMN IF NOT EXISTS nav_match_status text NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS nav_match_score numeric,
  ADD COLUMN IF NOT EXISTS nav_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS nav_record_id uuid,
  ADD COLUMN IF NOT EXISTS nav_difference jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_reconciled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS purchase_invoices_document_hash_idx
  ON public.purchase_invoices (organization_slug, document_hash)
  WHERE document_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_invoices_nav_status_idx
  ON public.purchase_invoices (organization_slug, nav_match_status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS purchase_invoices_amount_confidence_idx
  ON public.purchase_invoices (organization_slug, amount_confidence)
  WHERE amount_confidence IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.purchase_invoice_nav_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text,
  source text NOT NULL DEFAULT 'nav_import',
  source_id text,
  buyer_tax_id text,
  supplier_tax_id text,
  supplier_name text,
  invoice_number text,
  invoice_date date,
  performance_date date,
  due_date date,
  currency text NOT NULL DEFAULT 'HUF',
  net_amount numeric,
  vat_amount numeric,
  total_amount numeric,
  invoice_operation text,
  matched_invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'unmatched',
  match_score numeric,
  match_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- PostgreSQL permits multiple NULL source_id values here while PostgREST can
-- still infer this exact conflict target for deterministic upserts.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoice_nav_source_unique_idx
  ON public.purchase_invoice_nav_records (organization_slug, source, source_id);
CREATE INDEX IF NOT EXISTS purchase_invoice_nav_match_idx
  ON public.purchase_invoice_nav_records (organization_slug, match_status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS purchase_invoice_nav_key_idx
  ON public.purchase_invoice_nav_records (organization_slug, supplier_tax_id, invoice_number);

CREATE TABLE IF NOT EXISTS public.purchase_invoice_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text,
  source text NOT NULL DEFAULT 'nav_import',
  imported_by uuid,
  records_received integer NOT NULL DEFAULT 0,
  exact_matches integer NOT NULL DEFAULT 0,
  probable_matches integer NOT NULL DEFAULT 0,
  conflicts integer NOT NULL DEFAULT 0,
  missing_in_hotelcare integer NOT NULL DEFAULT 0,
  missing_in_nav integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS purchase_invoice_reconciliation_runs_org_idx
  ON public.purchase_invoice_reconciliation_runs (organization_slug, started_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_automation_settings (
  organization_slug text PRIMARY KEY,
  amount_verifier_enabled boolean NOT NULL DEFAULT true,
  amount_auto_accept_confidence numeric NOT NULL DEFAULT 0.94,
  require_amount_balance boolean NOT NULL DEFAULT true,
  duplicate_detection_enabled boolean NOT NULL DEFAULT true,
  nav_reconciliation_enabled boolean NOT NULL DEFAULT false,
  nav_auto_match_threshold numeric NOT NULL DEFAULT 0.97,
  nav_amount_tolerance_huf numeric NOT NULL DEFAULT 2,
  nav_date_tolerance_days integer NOT NULL DEFAULT 2,
  block_approval_on_nav_conflict boolean NOT NULL DEFAULT true,
  block_approval_on_amount_conflict boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Centralized finance-admin check avoids granting mutation rights to every user
-- in a tenant merely because they can read finance analytics.
CREATE OR REPLACE FUNCTION public.can_manage_invoice_finance(target_org text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.organization_slug = target_org
        AND p.role IN ('admin', 'top_management', 'top_management_manager')
    )
    OR EXISTS (
      SELECT 1
      FROM public.finance_access fa
      WHERE fa.user_id = auth.uid()
        AND fa.organization_slug = target_org
        AND fa.profile = 'chief_controller'
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_invoice_finance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_invoice_finance(text) TO authenticated;

ALTER TABLE public.purchase_invoice_nav_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_automation_settings ENABLE ROW LEVEL SECURITY;

-- NAV rows and run history are written only by the server-side reconciliation
-- function (service role). Browser users receive read access for their own org.
DROP POLICY IF EXISTS "invoice_nav_records_same_org" ON public.purchase_invoice_nav_records;
DROP POLICY IF EXISTS "invoice_nav_records_read_same_org" ON public.purchase_invoice_nav_records;
CREATE POLICY "invoice_nav_records_read_same_org"
  ON public.purchase_invoice_nav_records
  FOR SELECT
  USING (
    organization_slug = (
      SELECT p.organization_slug FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invoice_reconciliation_runs_same_org" ON public.purchase_invoice_reconciliation_runs;
DROP POLICY IF EXISTS "invoice_reconciliation_runs_read_same_org" ON public.purchase_invoice_reconciliation_runs;
CREATE POLICY "invoice_reconciliation_runs_read_same_org"
  ON public.purchase_invoice_reconciliation_runs
  FOR SELECT
  USING (
    organization_slug = (
      SELECT p.organization_slug FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invoice_automation_settings_same_org" ON public.invoice_automation_settings;
DROP POLICY IF EXISTS "invoice_automation_settings_read" ON public.invoice_automation_settings;
DROP POLICY IF EXISTS "invoice_automation_settings_insert" ON public.invoice_automation_settings;
DROP POLICY IF EXISTS "invoice_automation_settings_update" ON public.invoice_automation_settings;
DROP POLICY IF EXISTS "invoice_automation_settings_delete" ON public.invoice_automation_settings;

CREATE POLICY "invoice_automation_settings_read"
  ON public.invoice_automation_settings
  FOR SELECT
  USING (
    organization_slug = (
      SELECT p.organization_slug FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "invoice_automation_settings_insert"
  ON public.invoice_automation_settings
  FOR INSERT
  WITH CHECK (public.can_manage_invoice_finance(organization_slug));

CREATE POLICY "invoice_automation_settings_update"
  ON public.invoice_automation_settings
  FOR UPDATE
  USING (public.can_manage_invoice_finance(organization_slug))
  WITH CHECK (public.can_manage_invoice_finance(organization_slug));

CREATE POLICY "invoice_automation_settings_delete"
  ON public.invoice_automation_settings
  FOR DELETE
  USING (public.can_manage_invoice_finance(organization_slug));
