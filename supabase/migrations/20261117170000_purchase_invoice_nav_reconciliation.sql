-- ============================================================================
-- HotelCare Purchase Invoices — NAV Online Számla (read-only) synchronization,
-- reconciliation, missing-document follow-up, approval controls and a
-- configurable module rollout.
--
-- Additive and idempotent. No existing accounting values are rewritten.
-- Existing tables only receive new columns, a relaxed file_path NOT NULL for
-- historical imports, stricter storage/legal-entity policies and guard
-- triggers. Rollback script:
--   supabase/rollbacks/20261117170000_purchase_invoice_nav_reconciliation_down.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Module rollout (replaces the single-account legacy gate from PR #434
--    for Purchase Invoices; Parking Tickets keeps its legacy gate).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pi_module_settings (
  organization_slug text PRIMARY KEY,
  module_enabled boolean NOT NULL DEFAULT false,
  allowed_roles text[] NOT NULL DEFAULT ARRAY['admin','top_management','top_management_manager','control_finance','back_office']::text[],
  auto_reconcile boolean NOT NULL DEFAULT true,
  auto_apply_gap_fill boolean NOT NULL DEFAULT true,
  amount_tolerance_huf numeric NOT NULL DEFAULT 1 CHECK (amount_tolerance_huf >= 0 AND amount_tolerance_huf <= 100),
  amount_tolerance_foreign numeric NOT NULL DEFAULT 0.01 CHECK (amount_tolerance_foreign >= 0 AND amount_tolerance_foreign <= 5),
  date_tolerance_days integer NOT NULL DEFAULT 3 CHECK (date_tolerance_days BETWEEN 0 AND 31),
  reporting_delay_days integer NOT NULL DEFAULT 5 CHECK (reporting_delay_days BETWEEN 0 AND 60),
  sync_interval_minutes integer NOT NULL DEFAULT 120 CHECK (sync_interval_minutes BETWEEN 30 AND 1440),
  backfill_days integer NOT NULL DEFAULT 45 CHECK (backfill_days BETWEEN 7 AND 120),
  block_approval_on_exceptions boolean NOT NULL DEFAULT true,
  require_separate_approver boolean NOT NULL DEFAULT false,
  require_nav_match_for_approval boolean NOT NULL DEFAULT false,
  daily_summary_enabled boolean NOT NULL DEFAULT false,
  notification_recipient_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  -- Go-live cut-off: unmatched NAV invoices issued before it never raise missing-document follow-ups.
  reconciliation_start_date date,
  default_cost_centre_id uuid REFERENCES public.invoice_cost_centres(id) ON DELETE SET NULL,
  default_category_id uuid REFERENCES public.purchase_invoice_categories(id) ON DELETE SET NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Server-side check used by RLS, storage policies and Edge Functions.
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
         -- Legacy owner account retained from PR #434 so nothing regresses.
         lower(btrim(coalesce(p.nickname, ''))) = 'anu_000'
         OR (coalesce(s.module_enabled, false) AND (
               (fa.profile IS NOT NULL AND fa.profile <> 'none'::public.finance_profile)
               OR p.role::text = ANY (coalesce(s.allowed_roles, '{}'::text[]))
             ))
       )
  )
$$;

CREATE OR REPLACE FUNCTION public.pi_module_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.pi_module_access_for(auth.uid()) $$;

REVOKE ALL ON FUNCTION public.pi_module_access_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_module_access_for(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.pi_module_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pi_module_access() TO authenticated, service_role;

ALTER TABLE public.pi_module_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.pi_module_settings TO authenticated;
GRANT ALL ON public.pi_module_settings TO service_role;
DROP POLICY IF EXISTS pi_settings_read ON public.pi_module_settings;
CREATE POLICY pi_settings_read ON public.pi_module_settings FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org());
DROP POLICY IF EXISTS pi_settings_admin_insert ON public.pi_module_settings;
CREATE POLICY pi_settings_admin_insert ON public.pi_module_settings FOR INSERT TO authenticated
  WITH CHECK (organization_slug = public.pi_user_org() AND public.fin_is_admin());
DROP POLICY IF EXISTS pi_settings_admin_update ON public.pi_module_settings;
CREATE POLICY pi_settings_admin_update ON public.pi_module_settings FOR UPDATE TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.fin_is_admin())
  WITH CHECK (organization_slug = public.pi_user_org() AND public.fin_is_admin());

DROP TRIGGER IF EXISTS trg_pi_module_settings_updated ON public.pi_module_settings;
CREATE TRIGGER trg_pi_module_settings_updated BEFORE UPDATE ON public.pi_module_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8-digit core of a Hungarian tax number ("10773381-2-44" and "10773381" match);
-- foreign identifiers are compared in full.
CREATE OR REPLACE FUNCTION public.pi_tax_core(_raw text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE WHEN n ~ '^[0-9]{8}([0-9]{3})?$' THEN left(n, 8) ELSE n END
    FROM (SELECT public.pi_norm_tax_id(_raw) AS n) s
$$;

-- ---------------------------------------------------------------------------
-- 2. Legal companies: registered address, defaults; admin-only writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_buyer_companies
  ADD COLUMN IF NOT EXISTS registered_address text,
  ADD COLUMN IF NOT EXISTS default_cost_centre_id uuid REFERENCES public.invoice_cost_centres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_category_id uuid REFERENCES public.purchase_invoice_categories(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "Admins manage buyer companies" ON public.invoice_buyer_companies;
DROP POLICY IF EXISTS ibc_admin_insert ON public.invoice_buyer_companies;
DROP POLICY IF EXISTS ibc_admin_update ON public.invoice_buyer_companies;
DROP POLICY IF EXISTS ibc_admin_delete ON public.invoice_buyer_companies;
CREATE POLICY ibc_admin_insert ON public.invoice_buyer_companies FOR INSERT TO authenticated
  WITH CHECK (organization_slug = public.pi_user_org() AND public.fin_is_admin());
CREATE POLICY ibc_admin_update ON public.invoice_buyer_companies FOR UPDATE TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.fin_is_admin())
  WITH CHECK (organization_slug = public.pi_user_org() AND public.fin_is_admin());
CREATE POLICY ibc_admin_delete ON public.invoice_buyer_companies FOR DELETE TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.fin_is_admin());

-- ---------------------------------------------------------------------------
-- 3. Purchase invoice columns for OCR evidence, validation and NAV state.
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS import_row_hash text,
  ADD COLUMN IF NOT EXISTS document_kind text,
  ADD COLUMN IF NOT EXISTS reference_invoice_number text,
  ADD COLUMN IF NOT EXISTS service_period_start date,
  ADD COLUMN IF NOT EXISTS service_period_end date,
  ADD COLUMN IF NOT EXISTS amount_due numeric,
  ADD COLUMN IF NOT EXISTS previous_balance numeric,
  ADD COLUMN IF NOT EXISTS advance_paid_amount numeric,
  ADD COLUMN IF NOT EXISTS discount_amount numeric,
  ADD COLUMN IF NOT EXISTS merchant_bank_account text,
  ADD COLUMN IF NOT EXISTS preview_path text,
  ADD COLUMN IF NOT EXISTS currency_source text,
  ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_original jsonb,
  ADD COLUMN IF NOT EXISTS validation_status text,
  ADD COLUMN IF NOT EXISTS validation_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_provider text,
  ADD COLUMN IF NOT EXISTS ocr_model text,
  ADD COLUMN IF NOT EXISTS ocr_version text,
  ADD COLUMN IF NOT EXISTS extraction_passes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nav_match_status text NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS nav_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS nav_match_score numeric,
  ADD COLUMN IF NOT EXISTS nav_match_reason text,
  ADD COLUMN IF NOT EXISTS nav_match_explanation jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nav_differences jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nav_duplicate_of uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nav_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS nav_manual_status text,
  ADD COLUMN IF NOT EXISTS nav_manual_nav_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS nav_manual_reason text,
  ADD COLUMN IF NOT EXISTS nav_manual_by uuid,
  ADD COLUMN IF NOT EXISTS nav_manual_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_source_check
    CHECK (source IN ('upload','historical_import','email','supplier_feed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_document_kind_check
    CHECK (document_kind IS NULL OR document_kind IN ('normal_invoice','receipt','proforma','advance_invoice','final_invoice','corrective_invoice','credit_note','cancellation','unknown'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_validation_status_check
    CHECK (validation_status IS NULL OR validation_status IN ('ok','warning','error'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_nav_match_status_check
    CHECK (nav_match_status IN ('not_checked','exact_match','probable_match','document_only','data_mismatch','duplicate_document','competing_nav_candidates','correction_chain','nav_sync_pending','not_expected','manual_resolution'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_nav_manual_status_check
    CHECK (nav_manual_status IS NULL OR nav_manual_status IN ('matched','not_expected','unmatched'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Historical registrations (CSV/XLSX migration) may have no stored file.
ALTER TABLE public.purchase_invoices ALTER COLUMN file_path DROP NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_file_required
    CHECK (file_path IS NOT NULL OR source = 'historical_import') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.purchase_invoices VALIDATE CONSTRAINT purchase_invoices_file_required;

-- Classify existing rows into the new document taxonomy (new column only).
UPDATE public.purchase_invoices
   SET document_kind = CASE
         WHEN document_type = 'receipt' THEN 'receipt'
         WHEN is_credit_note THEN 'credit_note'
         WHEN document_type = 'invoice' THEN 'normal_invoice'
         ELSE 'unknown' END
 WHERE document_kind IS NULL AND document_type IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_invoices_import_row_uidx
  ON public.purchase_invoices (organization_slug, import_row_hash) WHERE import_row_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_invoices_nav_status_idx
  ON public.purchase_invoices (organization_slug, nav_match_status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS purchase_invoices_nav_invoice_idx ON public.purchase_invoices (nav_invoice_id);

-- ---------------------------------------------------------------------------
-- 4. NAV connections (one per legal company and environment) + secrets.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pi_nav_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.invoice_buyer_companies(id) ON DELETE RESTRICT,
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','production')),
  tax_number text NOT NULL CHECK (tax_number ~ '^[0-9]{8}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','active','error','disabled')),
  enabled boolean NOT NULL DEFAULT false,
  use_for_reconciliation boolean NOT NULL DEFAULT false,
  credentials_set boolean NOT NULL DEFAULT false,
  credentials_updated_at timestamptz,
  login_hint text,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_result jsonb,
  sync_from_date date,
  initial_sync_through date,
  initial_sync_completed_at timestamptz,
  ins_date_cursor timestamptz,
  last_backfill_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_sync_state text CHECK (last_sync_state IS NULL OR last_sync_state IN ('full','partial','failed')),
  consecutive_failures integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error_code text,
  last_error_category text,
  last_error_message text,
  sync_lock_until timestamptz,
  sync_lock_token uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, company_id, environment)
);
CREATE INDEX IF NOT EXISTS pi_nav_connections_due_idx ON public.pi_nav_connections (enabled, next_retry_at, last_attempt_at);

DROP TRIGGER IF EXISTS trg_pi_nav_connections_updated ON public.pi_nav_connections;
CREATE TRIGGER trg_pi_nav_connections_updated BEFORE UPDATE ON public.pi_nav_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Encrypted credential envelopes: NO policies → unreadable for anon/authenticated.
CREATE TABLE IF NOT EXISTS public.pi_nav_connection_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.pi_nav_connections(id) ON DELETE CASCADE,
  credential_ciphertext text NOT NULL,
  credential_iv text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pi_nav_connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_nav_connection_secrets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pi_nav_connection_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pi_nav_connection_secrets TO service_role;

-- Dedicated 256-bit AES-GCM key in Supabase Vault (separate from Számlázz keys).
DO $$
BEGIN
  IF to_regnamespace('vault') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'hotelcare_nav_credential_key') THEN
    PERFORM vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
      'hotelcare_nav_credential_key',
      'AES-256-GCM key for NAV Online Szamla technical-user credentials; never rotate without re-encrypting pi_nav_connection_secrets'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.nav_credential_key_internal()
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'hotelcare_nav_credential_key' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.nav_credential_key_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nav_credential_key_internal() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Normalized NAV invoice store (never merged into uploaded documents).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pi_nav_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.invoice_buyer_companies(id) ON DELETE RESTRICT,
  connection_id uuid REFERENCES public.pi_nav_connections(id) ON DELETE SET NULL,
  environment text NOT NULL CHECK (environment IN ('test','production')),
  source_key text NOT NULL,
  hotel_id text,
  supplier_tax_number text NOT NULL,
  supplier_tax_number_full text,
  supplier_group_member_tax_number text,
  supplier_name text,
  supplier_address text,
  supplier_bank_account text,
  customer_tax_number text,
  customer_group_member_tax_number text,
  customer_name text,
  invoice_number text NOT NULL,
  normalized_invoice_number text GENERATED ALWAYS AS (public.pi_norm_doc_number(invoice_number)) STORED,
  invoice_operation text NOT NULL CHECK (invoice_operation IN ('CREATE','MODIFY','STORNO')),
  invoice_category text,
  invoice_issue_date date,
  invoice_delivery_date date,
  payment_date date,
  payment_method text,
  invoice_appearance text,
  nav_source text,
  currency text,
  exchange_rate numeric,
  net_amount numeric,
  vat_amount numeric,
  gross_amount numeric,
  net_amount_huf numeric,
  vat_amount_huf numeric,
  gross_amount_huf numeric,
  original_invoice_number text,
  modification_index integer,
  batch_index integer,
  transaction_id text,
  report_index integer,
  ins_date timestamptz NOT NULL,
  completeness_indicator boolean,
  vat_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_digest jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail_status text NOT NULL DEFAULT 'digest_only' CHECK (detail_status IN ('digest_only','detail_fetched','detail_unavailable','detail_failed')),
  detail_fetched_at timestamptz,
  detail_attempts integer NOT NULL DEFAULT 0,
  detail_error text,
  match_status text NOT NULL DEFAULT 'nav_only' CHECK (match_status IN ('exact_match','probable_match','nav_only','data_mismatch','competing_nav_candidates','correction_chain','not_expected','manual_resolution')),
  matched_invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  match_score numeric,
  match_reason text,
  match_explanation jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicate_document_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  matched_at timestamptz,
  manual_status text CHECK (manual_status IS NULL OR manual_status = 'not_expected'),
  manual_reason text,
  manual_by uuid,
  manual_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_sync_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, environment, source_key)
);
CREATE INDEX IF NOT EXISTS pi_nav_invoices_status_idx ON public.pi_nav_invoices (organization_slug, company_id, match_status, invoice_issue_date DESC);
CREATE INDEX IF NOT EXISTS pi_nav_invoices_key_idx ON public.pi_nav_invoices (company_id, supplier_tax_number, normalized_invoice_number);
CREATE INDEX IF NOT EXISTS pi_nav_invoices_matched_idx ON public.pi_nav_invoices (matched_invoice_id);
CREATE INDEX IF NOT EXISTS pi_nav_invoices_detail_idx ON public.pi_nav_invoices (company_id, detail_status) WHERE detail_status IN ('digest_only','detail_failed');

DROP TRIGGER IF EXISTS trg_pi_nav_invoices_updated ON public.pi_nav_invoices;
CREATE TRIGGER trg_pi_nav_invoices_updated BEFORE UPDATE ON public.pi_nav_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$ BEGIN
  ALTER TABLE public.purchase_invoices ADD CONSTRAINT purchase_invoices_nav_invoice_fk
    FOREIGN KEY (nav_invoice_id) REFERENCES public.pi_nav_invoices(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 6. Sync runs, detailed sync events, reconciliation audit, provenance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pi_nav_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.invoice_buyer_companies(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.pi_nav_connections(id) ON DELETE SET NULL,
  environment text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('manual','schedule','initial','backfill','test')),
  mode text NOT NULL CHECK (mode IN ('incremental','initial','backfill','details','test')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','partial','failed')),
  window_from text,
  window_to text,
  pages_fetched integer NOT NULL DEFAULT 0,
  digests_received integer NOT NULL DEFAULT 0,
  records_upserted integer NOT NULL DEFAULT 0,
  details_fetched integer NOT NULL DEFAULT 0,
  details_failed integer NOT NULL DEFAULT 0,
  error_code text,
  error_category text,
  error_message text,
  requested_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS pi_nav_sync_runs_company_idx ON public.pi_nav_sync_runs (company_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.pi_nav_sync_events (
  id bigserial PRIMARY KEY,
  run_id uuid REFERENCES public.pi_nav_sync_runs(id) ON DELETE CASCADE,
  organization_slug text NOT NULL,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pi_nav_sync_events_run_idx ON public.pi_nav_sync_events (run_id, id);

CREATE TABLE IF NOT EXISTS public.pi_reconciliation_events (
  id bigserial PRIMARY KEY,
  organization_slug text NOT NULL,
  company_id uuid,
  invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  nav_invoice_id uuid REFERENCES public.pi_nav_invoices(id) ON DELETE SET NULL,
  actor_id uuid,
  actor_kind text NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('system','user')),
  action text NOT NULL,
  old_status text,
  new_status text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pi_recon_events_invoice_idx ON public.pi_reconciliation_events (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pi_recon_events_nav_idx ON public.pi_reconciliation_events (nav_invoice_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pi_invoice_field_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  nav_invoice_id uuid REFERENCES public.pi_nav_invoices(id) ON DELETE SET NULL,
  field text NOT NULL,
  ocr_value text,
  nav_value text,
  final_value text,
  action text NOT NULL CHECK (action IN ('fill','propose','conflict','equivalent')),
  rule text,
  material boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','accepted','rejected','resolved')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, field)
);
CREATE INDEX IF NOT EXISTS pi_provenance_open_idx ON public.pi_invoice_field_provenance (invoice_id) WHERE action = 'conflict' AND status = 'open';

CREATE OR REPLACE FUNCTION public.pi_open_conflict_count(_invoice_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::integer FROM public.pi_invoice_field_provenance
   WHERE invoice_id = _invoice_id AND action = 'conflict' AND material AND status = 'open'
$$;
REVOKE ALL ON FUNCTION public.pi_open_conflict_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pi_open_conflict_count(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Missing-document follow-up.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pi_missing_document_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  company_id uuid NOT NULL REFERENCES public.invoice_buyer_companies(id) ON DELETE CASCADE,
  nav_invoice_id uuid NOT NULL UNIQUE REFERENCES public.pi_nav_invoices(id) ON DELETE CASCADE,
  hotel_id text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','requested','in_progress','resolved','dismissed')),
  assigned_to uuid,
  requested_from_hotel text,
  requested_at timestamptz,
  requested_by uuid,
  due_date date,
  resolution text CHECK (resolution IS NULL OR resolution IN ('document_matched','document_uploaded','not_required','nav_error','other')),
  resolved_by uuid,
  resolved_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pi_followups_open_idx ON public.pi_missing_document_followups (organization_slug, company_id, status);
CREATE INDEX IF NOT EXISTS pi_followups_assignee_idx ON public.pi_missing_document_followups (assigned_to) WHERE status IN ('open','requested','in_progress');

DROP TRIGGER IF EXISTS trg_pi_followups_updated ON public.pi_missing_document_followups;
CREATE TRIGGER trg_pi_followups_updated BEFORE UPDATE ON public.pi_missing_document_followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.pi_missing_document_notes (
  id bigserial PRIMARY KEY,
  followup_id uuid NOT NULL REFERENCES public.pi_missing_document_followups(id) ON DELETE CASCADE,
  organization_slug text NOT NULL,
  author_id uuid NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 8. Processing jobs (created immediately on upload; recoverable).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pi_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  invoice_id uuid NOT NULL UNIQUE REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error_code text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS pi_jobs_due_idx ON public.pi_processing_jobs (status, next_attempt_at);

CREATE OR REPLACE FUNCTION public.pi_enqueue_processing_job()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.file_path IS NOT NULL AND NEW.source <> 'historical_import' THEN
    INSERT INTO public.pi_processing_jobs (organization_slug, invoice_id)
    VALUES (NEW.organization_slug, NEW.id)
    ON CONFLICT (invoice_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pi_enqueue_processing_job() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pi_enqueue_job ON public.purchase_invoices;
CREATE TRIGGER trg_pi_enqueue_job AFTER INSERT ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.pi_enqueue_processing_job();

-- Atomic, idempotent claim: concurrent or repeated executions cannot both win.
CREATE OR REPLACE FUNCTION public.pi_claim_processing_job(_invoice_id uuid, _lock_token uuid, _force boolean DEFAULT false)
RETURNS TABLE (claimed boolean, attempts integer, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  rec record;
BEGIN
  INSERT INTO public.pi_processing_jobs (organization_slug, invoice_id)
  SELECT organization_slug, id FROM public.purchase_invoices WHERE id = _invoice_id
  ON CONFLICT (invoice_id) DO NOTHING;

  UPDATE public.pi_processing_jobs j
     SET status = 'running', locked_at = now(), lock_token = _lock_token,
         attempts = CASE WHEN _force AND j.status IN ('failed','succeeded') THEN 1 ELSE j.attempts + 1 END,
         updated_at = now()
   WHERE j.invoice_id = _invoice_id
     AND (
       (j.status = 'queued' AND (j.next_attempt_at <= now() OR _force))
       OR (j.status = 'failed' AND (j.attempts < j.max_attempts OR _force))
       OR (j.status = 'running' AND j.locked_at < now() - interval '10 minutes')
       OR (_force AND j.status = 'succeeded')
     )
  RETURNING j.attempts AS attempts, j.status AS status INTO rec;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, j.attempts, j.status FROM public.pi_processing_jobs j WHERE j.invoice_id = _invoice_id;
  ELSE
    RETURN QUERY SELECT true, rec.attempts, rec.status;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pi_finish_processing_job(_invoice_id uuid, _lock_token uuid, _ok boolean, _error_code text DEFAULT NULL, _error text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.pi_processing_jobs
     SET status = CASE WHEN _ok THEN 'succeeded' WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         next_attempt_at = CASE WHEN _ok THEN next_attempt_at ELSE now() + make_interval(mins => 5 * attempts) END,
         last_error_code = CASE WHEN _ok THEN NULL ELSE left(_error_code, 80) END,
         last_error = CASE WHEN _ok THEN NULL ELSE left(_error, 500) END,
         completed_at = CASE WHEN _ok THEN now() ELSE completed_at END,
         locked_at = NULL, lock_token = NULL, updated_at = now()
   WHERE invoice_id = _invoice_id AND lock_token = _lock_token
$$;
REVOKE ALL ON FUNCTION public.pi_claim_processing_job(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pi_finish_processing_job(uuid, uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_claim_processing_job(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.pi_finish_processing_job(uuid, uuid, boolean, text, text) TO service_role;

-- Exclusive per-connection sync lock (prevents overlapping cron/manual runs).
CREATE OR REPLACE FUNCTION public.pi_claim_nav_sync(_connection_id uuid, _lock_token uuid, _minutes integer DEFAULT 15)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ok boolean;
BEGIN
  UPDATE public.pi_nav_connections
     SET sync_lock_until = now() + make_interval(mins => greatest(1, least(_minutes, 60))),
         sync_lock_token = _lock_token, last_attempt_at = now()
   WHERE id = _connection_id AND (sync_lock_until IS NULL OR sync_lock_until < now())
  RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END $$;
CREATE OR REPLACE FUNCTION public.pi_release_nav_sync(_connection_id uuid, _lock_token uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.pi_nav_connections SET sync_lock_until = NULL, sync_lock_token = NULL
   WHERE id = _connection_id AND sync_lock_token = _lock_token
$$;
REVOKE ALL ON FUNCTION public.pi_claim_nav_sync(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pi_release_nav_sync(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_claim_nav_sync(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pi_release_nav_sync(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Who may see NAV data / manage NAV inside an organization.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pi_can_view_nav(_company_id uuid, _hotel_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.pi_module_access() AND (
    public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance'])
    OR (public.fin_profile() IN ('reviewer','controller','chief_controller','management_read')
        AND public.fin_scope_ok(_company_id, _hotel_id))
    OR (public.pi_user_role() = 'back_office' AND _hotel_id IS NOT NULL AND _hotel_id = public.pi_user_hotel())
  )
$$;

CREATE OR REPLACE FUNCTION public.pi_can_control_nav()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.pi_module_access() AND (
    public.fin_is_admin() OR public.fin_can_approve()
    OR public.pi_user_role() = 'control_finance'
  )
$$;
REVOKE ALL ON FUNCTION public.pi_can_view_nav(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pi_can_control_nav() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pi_can_view_nav(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pi_can_control_nav() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. RLS for the new tables. Writes to NAV data are server-side only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pi_nav_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_nav_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_nav_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_nav_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_invoice_field_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_missing_document_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_missing_document_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pi_processing_jobs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.pi_nav_connections, public.pi_nav_invoices, public.pi_nav_sync_runs,
  public.pi_nav_sync_events, public.pi_reconciliation_events, public.pi_invoice_field_provenance,
  public.pi_processing_jobs TO authenticated;
GRANT SELECT, UPDATE ON public.pi_missing_document_followups TO authenticated;
GRANT SELECT, INSERT ON public.pi_missing_document_notes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pi_missing_document_notes_id_seq TO authenticated;
GRANT ALL ON public.pi_nav_connections, public.pi_nav_invoices, public.pi_nav_sync_runs, public.pi_nav_sync_events,
  public.pi_reconciliation_events, public.pi_invoice_field_provenance, public.pi_missing_document_followups,
  public.pi_missing_document_notes, public.pi_processing_jobs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pi_nav_sync_events_id_seq, public.pi_reconciliation_events_id_seq,
  public.pi_missing_document_notes_id_seq TO service_role;

DROP POLICY IF EXISTS pi_nav_conn_read ON public.pi_nav_connections;
CREATE POLICY pi_nav_conn_read ON public.pi_nav_connections FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_can_control_nav());

DROP POLICY IF EXISTS pi_nav_invoices_read ON public.pi_nav_invoices;
CREATE POLICY pi_nav_invoices_read ON public.pi_nav_invoices FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_can_view_nav(company_id, hotel_id));

DROP POLICY IF EXISTS pi_nav_runs_read ON public.pi_nav_sync_runs;
CREATE POLICY pi_nav_runs_read ON public.pi_nav_sync_runs FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_can_control_nav());

DROP POLICY IF EXISTS pi_nav_events_read ON public.pi_nav_sync_events;
CREATE POLICY pi_nav_events_read ON public.pi_nav_sync_events FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_can_control_nav());

DROP POLICY IF EXISTS pi_recon_events_read ON public.pi_reconciliation_events;
CREATE POLICY pi_recon_events_read ON public.pi_reconciliation_events FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND (
    (invoice_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id))
    OR (nav_invoice_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.pi_nav_invoices n WHERE n.id = nav_invoice_id))
  ));

DROP POLICY IF EXISTS pi_provenance_read ON public.pi_invoice_field_provenance;
CREATE POLICY pi_provenance_read ON public.pi_invoice_field_provenance FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id));

DROP POLICY IF EXISTS pi_jobs_read ON public.pi_processing_jobs;
CREATE POLICY pi_jobs_read ON public.pi_processing_jobs FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id));

DROP POLICY IF EXISTS pi_followups_read ON public.pi_missing_document_followups;
CREATE POLICY pi_followups_read ON public.pi_missing_document_followups FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_module_access()
         AND (public.pi_can_view_nav(company_id, hotel_id) OR assigned_to = auth.uid()));
DROP POLICY IF EXISTS pi_followups_update ON public.pi_missing_document_followups;
CREATE POLICY pi_followups_update ON public.pi_missing_document_followups FOR UPDATE TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_module_access()
         AND (public.pi_can_control_nav() OR assigned_to = auth.uid()))
  WITH CHECK (organization_slug = public.pi_user_org() AND public.pi_module_access()
         AND (public.pi_can_control_nav() OR assigned_to = auth.uid()));

DROP POLICY IF EXISTS pi_followup_notes_read ON public.pi_missing_document_notes;
CREATE POLICY pi_followup_notes_read ON public.pi_missing_document_notes FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND EXISTS (SELECT 1 FROM public.pi_missing_document_followups f WHERE f.id = followup_id));
DROP POLICY IF EXISTS pi_followup_notes_insert ON public.pi_missing_document_notes;
CREATE POLICY pi_followup_notes_insert ON public.pi_missing_document_notes FOR INSERT TO authenticated
  WITH CHECK (organization_slug = public.pi_user_org() AND author_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.pi_missing_document_followups f WHERE f.id = followup_id));

-- Assignees may only move their follow-up to in_progress; controllers decide the rest.
CREATE OR REPLACE FUNCTION public.pi_guard_followup_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.organization_slug IS DISTINCT FROM OLD.organization_slug OR NEW.nav_invoice_id IS DISTINCT FROM OLD.nav_invoice_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Follow-up identity cannot change' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL OR public.pi_can_control_nav() THEN
    IF NEW.status IN ('resolved','dismissed') AND OLD.status NOT IN ('resolved','dismissed') AND auth.uid() IS NOT NULL THEN
      NEW.resolved_by := auth.uid();
      NEW.resolved_at := now();
    END IF;
    IF NEW.status = 'requested' AND OLD.status IS DISTINCT FROM 'requested' AND auth.uid() IS NOT NULL THEN
      NEW.requested_by := auth.uid();
      NEW.requested_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at'])
     OR NEW.status NOT IN ('in_progress', OLD.status) THEN
    RAISE EXCEPTION 'Only controlling can reassign or close this follow-up' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pi_guard_followup_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pi_guard_followup ON public.pi_missing_document_followups;
CREATE TRIGGER trg_pi_guard_followup BEFORE UPDATE ON public.pi_missing_document_followups
  FOR EACH ROW EXECUTE FUNCTION public.pi_guard_followup_update();

-- Module rollout is enforced in the database, not only by hiding the UI.
DROP POLICY IF EXISTS pi_module_gate ON public.purchase_invoices;
CREATE POLICY pi_module_gate ON public.purchase_invoices AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.pi_module_access()) WITH CHECK (public.pi_module_access());

-- ---------------------------------------------------------------------------
-- 11. Storage: fix cross-tenant read/delete of invoice files and gate by module.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pi_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "pi_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "pi_storage_delete" ON storage.objects;
DROP POLICY IF EXISTS pi_storage_read_scoped ON storage.objects;
DROP POLICY IF EXISTS pi_storage_insert_scoped ON storage.objects;
DROP POLICY IF EXISTS pi_storage_delete_scoped ON storage.objects;

-- Read: same organization folder AND an invoice row the caller may see.
CREATE POLICY pi_storage_read_scoped ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'purchase-invoices'
  AND (storage.foldername(name))[1] = public.pi_user_org()
  AND public.pi_module_access()
  AND EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.file_path = objects.name OR i.preview_path = objects.name)
);
CREATE POLICY pi_storage_insert_scoped ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'purchase-invoices'
  AND (storage.foldername(name))[1] = public.pi_user_org()
  AND public.pi_module_access()
);
-- Delete: organization admins only, own organization, never approved invoices.
CREATE POLICY pi_storage_delete_scoped ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'purchase-invoices'
  AND (storage.foldername(name))[1] = public.pi_user_org()
  AND public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager'])
  AND public.pi_module_access()
  AND NOT EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.file_path = objects.name AND i.approval_status = 'approved')
);

-- ---------------------------------------------------------------------------
-- 12. Approval, locking and integrity guard (enforced for every caller).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pi_guard_invoice_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  is_server boolean := auth.uid() IS NULL;   -- Edge Functions (service role) and migrations
  cfg public.pi_module_settings%ROWTYPE;
  -- Generated columns are excluded: inside BEFORE triggers NEW has not computed them yet.
  meta_keys text[] := ARRAY['nav_match_status','nav_invoice_id','nav_match_score','nav_match_reason','nav_match_explanation',
    'nav_differences','nav_duplicate_of','nav_last_checked_at','updated_at','normalized_invoice_number','normalized_merchant_tax_id'];
  server_only text[] := ARRAY['nav_match_status','nav_invoice_id','nav_match_score','nav_match_reason','nav_match_explanation',
    'nav_differences','nav_duplicate_of','nav_last_checked_at','nav_manual_status','nav_manual_nav_invoice_id','nav_manual_reason',
    'nav_manual_by','nav_manual_at','validation_status','validation_results','field_confidence','ocr_original','ocr_provider',
    'ocr_model','ocr_version','extraction_passes','import_batch_id','import_row_hash','source'];
  financial_keys text[] := ARRAY['merchant_name','merchant_tax_id','merchant_address','merchant_country','merchant_bank_account',
    'buyer_name','buyer_tax_id','buyer_address','buyer_company_id','invoice_number','invoice_date','due_date','performance_date',
    'currency','net_amount','total_vat_amount','total_amount','amount_due','hotel_id','cost_centre_id','expense_category_id',
    'is_credit_note','document_kind','reference_invoice_number','file_path','file_sha256'];
  k text;
  financial_changed boolean := false;
  review_roles text[] := ARRAY['admin','top_management','top_management_manager','manager','control_finance','back_office',
    'back_office_manager','control_manager'];
BEGIN
  IF NEW.organization_slug IS DISTINCT FROM OLD.organization_slug OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
    RAISE EXCEPTION 'Invoice organization and uploader cannot change' USING ERRCODE = '42501';
  END IF;

  FOREACH k IN ARRAY financial_keys LOOP
    IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN financial_changed := true; EXIT; END IF;
  END LOOP;

  SELECT * INTO cfg FROM public.pi_module_settings WHERE organization_slug = NEW.organization_slug;
  IF NOT FOUND THEN
    cfg.block_approval_on_exceptions := true;
    cfg.require_separate_approver := false;
    cfg.require_nav_match_for_approval := false;
  END IF;

  -- Reconciliation, validation and OCR evidence are written by the server only.
  IF NOT is_server THEN
    FOREACH k IN ARRAY server_only LOOP
      IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
        RAISE EXCEPTION 'Field % is maintained by HotelCare and cannot be edited directly', k USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF NEW.duplicate_status IS DISTINCT FROM OLD.duplicate_status
       AND NOT (public.pi_user_role() = ANY (review_roles) OR public.fin_profile() IN ('reviewer','controller','chief_controller')) THEN
      RAISE EXCEPTION 'Only finance reviewers can resolve duplicates' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.ocr_original IS NOT NULL AND NEW.ocr_original IS DISTINCT FROM OLD.ocr_original THEN
    RAISE EXCEPTION 'The original OCR output is immutable' USING ERRCODE = '42501';
  END IF;

  -- Approved invoices are locked; only reconciliation metadata may change.
  IF OLD.approval_status = 'approved' THEN
    IF NEW.approval_status = 'approved' THEN
      IF (to_jsonb(NEW) - meta_keys) IS DISTINCT FROM (to_jsonb(OLD) - meta_keys) THEN
        RAISE EXCEPTION 'Approved invoices are locked. A chief controller must reopen the invoice first.' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    -- Reopen
    IF is_server OR public.fin_profile(actor) <> 'chief_controller' OR NOT public.fin_scope_ok(OLD.buyer_company_id, OLD.hotel_id, actor) THEN
      RAISE EXCEPTION 'Only a chief controller in scope can reopen an approved invoice' USING ERRCODE = '42501';
    END IF;
    IF btrim(coalesce(NEW.reopen_reason, '')) = '' OR financial_changed THEN
      RAISE EXCEPTION 'Reopening requires a reason and must not change invoice data in the same step' USING ERRCODE = '22023';
    END IF;
    NEW.reopened_by := actor;
    NEW.reopened_at := now();
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    RETURN NEW;
  END IF;

  -- Submission for approval
  IF NEW.review_status = 'pending_approval' AND OLD.review_status IS DISTINCT FROM 'pending_approval' THEN
    IF NOT is_server AND NOT (public.pi_user_role() = ANY (review_roles) OR public.fin_profile() IN ('reviewer','controller','chief_controller')) THEN
      RAISE EXCEPTION 'Only finance reviewers can submit invoices for approval' USING ERRCODE = '42501';
    END IF;
    IF NOT is_server THEN
      NEW.reviewed_by := actor;
      NEW.submitted_at := now();
    END IF;
  END IF;

  -- Approval
  IF NEW.approval_status = 'approved' THEN
    IF is_server THEN
      RAISE EXCEPTION 'Invoices are approved by people, not by automated processes' USING ERRCODE = '42501';
    END IF;
    IF NOT public.fin_can_approve(actor) OR NOT public.fin_scope_ok(NEW.buyer_company_id, NEW.hotel_id, actor) THEN
      RAISE EXCEPTION 'Only a controller in scope can approve this invoice' USING ERRCODE = '42501';
    END IF;
    IF OLD.review_status IS DISTINCT FROM 'pending_approval' THEN
      RAISE EXCEPTION 'Submit the invoice for approval first' USING ERRCODE = '22023';
    END IF;
    IF financial_changed THEN
      RAISE EXCEPTION 'Invoice data cannot change in the same step as approval' USING ERRCODE = '22023';
    END IF;
    IF cfg.require_separate_approver AND actor IN (OLD.uploaded_by, OLD.reviewed_by) THEN
      RAISE EXCEPTION 'Separation of duties: the uploader or reviewer cannot approve' USING ERRCODE = '42501';
    END IF;
    IF cfg.block_approval_on_exceptions THEN
      IF NEW.nav_match_status IN ('data_mismatch','duplicate_document','competing_nav_candidates','correction_chain') THEN
        RAISE EXCEPTION 'Resolve the NAV reconciliation exception (%) before approval', NEW.nav_match_status USING ERRCODE = '22023';
      END IF;
      IF NEW.duplicate_status IN ('suspected','confirmed') THEN
        RAISE EXCEPTION 'Resolve the suspected duplicate before approval' USING ERRCODE = '22023';
      END IF;
      IF public.pi_open_conflict_count(NEW.id) > 0 THEN
        RAISE EXCEPTION 'Resolve the document vs NAV field conflicts before approval' USING ERRCODE = '22023';
      END IF;
      IF NEW.validation_status = 'error' THEN
        RAISE EXCEPTION 'Fix the failed invoice checks before approval' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF cfg.require_nav_match_for_approval
       AND NEW.nav_match_status NOT IN ('exact_match','probable_match','manual_resolution','not_expected') THEN
      RAISE EXCEPTION 'A confirmed NAV match is required before approval' USING ERRCODE = '22023';
    END IF;
    -- Generated columns are not computed yet inside BEFORE triggers: normalize explicitly.
    IF public.pi_norm_doc_number(NEW.invoice_number) IS NOT NULL AND public.pi_tax_core(NEW.merchant_tax_id) IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.purchase_invoices o
       WHERE o.organization_slug = NEW.organization_slug AND o.id <> NEW.id AND o.approval_status = 'approved'
         AND public.pi_tax_core(o.merchant_tax_id) = public.pi_tax_core(NEW.merchant_tax_id)
         AND o.normalized_invoice_number = public.pi_norm_doc_number(NEW.invoice_number)
         AND coalesce(o.is_credit_note, false) = coalesce(NEW.is_credit_note, false)) THEN
      RAISE EXCEPTION 'Another approved invoice already has this supplier invoice number (duplicate approval)' USING ERRCODE = '23505';
    END IF;
    NEW.approved_by := actor;
    NEW.approved_at := now();
  ELSIF NEW.approval_status = 'rejected' AND OLD.approval_status IS DISTINCT FROM 'rejected' THEN
    IF is_server OR NOT public.fin_can_approve(actor) OR NOT public.fin_scope_ok(NEW.buyer_company_id, NEW.hotel_id, actor) THEN
      RAISE EXCEPTION 'Only a controller in scope can reject this invoice' USING ERRCODE = '42501';
    END IF;
    IF btrim(coalesce(NEW.rejection_reason, '')) = '' THEN
      RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = '22023';
    END IF;
    NEW.rejected_by := actor;
    NEW.rejected_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pi_guard_invoice_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pi_guard_update ON public.purchase_invoices;
CREATE TRIGGER trg_pi_guard_update BEFORE UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.pi_guard_invoice_update();

-- Browser inserts can never create pre-approved or pre-reconciled records.
CREATE OR REPLACE FUNCTION public.pi_guard_invoice_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  NEW.approval_status := 'none';
  NEW.approved_by := NULL; NEW.approved_at := NULL;
  NEW.rejected_by := NULL; NEW.rejected_at := NULL; NEW.rejection_reason := NULL;
  NEW.review_status := 'pending_review';
  NEW.reviewed_by := NULL; NEW.reviewed_at := NULL; NEW.submitted_at := NULL;
  NEW.is_verified := false; NEW.verified_by := NULL; NEW.verified_at := NULL;
  NEW.duplicate_status := 'none'; NEW.duplicate_of := NULL;
  NEW.nav_match_status := 'not_checked'; NEW.nav_invoice_id := NULL; NEW.nav_match_score := NULL;
  NEW.nav_match_reason := NULL; NEW.nav_match_explanation := '[]'::jsonb; NEW.nav_differences := '[]'::jsonb;
  NEW.nav_duplicate_of := NULL; NEW.nav_last_checked_at := NULL;
  NEW.nav_manual_status := NULL; NEW.nav_manual_nav_invoice_id := NULL; NEW.nav_manual_reason := NULL;
  NEW.nav_manual_by := NULL; NEW.nav_manual_at := NULL;
  NEW.validation_status := NULL; NEW.validation_results := '[]'::jsonb; NEW.field_confidence := '{}'::jsonb;
  NEW.ocr_original := NULL; NEW.ocr_provider := NULL; NEW.ocr_model := NULL; NEW.ocr_version := NULL; NEW.extraction_passes := 0;
  NEW.source := 'upload'; NEW.import_batch_id := NULL; NEW.import_row_hash := NULL;
  IF NEW.file_path IS NULL THEN
    RAISE EXCEPTION 'An uploaded invoice needs its document file' USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pi_guard_invoice_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pi_guard_insert ON public.purchase_invoices;
CREATE TRIGGER trg_pi_guard_insert BEFORE INSERT ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.pi_guard_invoice_insert();

-- Deletions: approved records are protected; every deletion is archived with its audit trail.
CREATE TABLE IF NOT EXISTS public.pi_deleted_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  invoice_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  audit_trail jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pi_deleted_invoices ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pi_deleted_invoices TO authenticated;
GRANT ALL ON public.pi_deleted_invoices TO service_role;
DROP POLICY IF EXISTS pi_deleted_read ON public.pi_deleted_invoices;
CREATE POLICY pi_deleted_read ON public.pi_deleted_invoices FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.fin_is_admin());

CREATE OR REPLACE FUNCTION public.pi_guard_invoice_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.approval_status = 'approved' THEN
    RAISE EXCEPTION 'Approved invoices cannot be deleted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.pi_deleted_invoices (organization_slug, invoice_id, snapshot, audit_trail, deleted_by)
  VALUES (OLD.organization_slug, OLD.id, to_jsonb(OLD) - 'raw_text',
          coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at) FROM public.purchase_invoice_audit_log a WHERE a.invoice_id = OLD.id), '[]'::jsonb),
          auth.uid());
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.pi_guard_invoice_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pi_guard_delete ON public.purchase_invoices;
CREATE TRIGGER trg_pi_guard_delete BEFORE DELETE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.pi_guard_invoice_delete();

-- Wider before/after audit coverage for corrections (keeps the existing actions).
CREATE OR REPLACE FUNCTION public.pi_audit_invoice_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  k text;
  tracked text[] := ARRAY['total_amount','net_amount','total_vat_amount','currency','invoice_number','invoice_date',
    'performance_date','due_date','merchant_name','merchant_tax_id','buyer_tax_id','buyer_company_id','cost_centre_id',
    'expense_category_id','hotel_id','document_kind','payment_method','merchant_bank_account'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, notes)
    VALUES (NEW.id, NEW.organization_slug, coalesce(actor, NEW.uploaded_by), CASE WHEN NEW.source = 'historical_import' THEN 'imported' ELSE 'uploaded' END, NEW.file_path);
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
    VALUES (NEW.id, NEW.organization_slug, actor, 'approval_' || NEW.approval_status, 'approval_status', OLD.approval_status, NEW.approval_status,
            coalesce(NEW.rejection_reason, NEW.reopen_reason));
  END IF;
  IF NEW.duplicate_status IS DISTINCT FROM OLD.duplicate_status THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'duplicate_decision', 'duplicate_status', OLD.duplicate_status, NEW.duplicate_status);
  END IF;
  IF NEW.nav_match_status IS DISTINCT FROM OLD.nav_match_status THEN
    INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
    VALUES (NEW.id, NEW.organization_slug, actor, 'nav_reconciliation', 'nav_match_status', OLD.nav_match_status, NEW.nav_match_status);
  END IF;
  FOREACH k IN ARRAY tracked LOOP
    IF (to_jsonb(NEW) ->> k) IS DISTINCT FROM (to_jsonb(OLD) ->> k) THEN
      INSERT INTO public.purchase_invoice_audit_log (invoice_id, organization_slug, user_id, action, field, old_value, new_value)
      VALUES (NEW.id, NEW.organization_slug, actor, CASE WHEN actor IS NULL THEN 'system_update' ELSE 'edited' END, k,
              to_jsonb(OLD) ->> k, to_jsonb(NEW) ->> k);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pi_audit_invoice_changes() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Server-side bulk writers used by the reconciliation runner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pi_apply_reconciliation(_organization_slug text, _documents jsonb, _nav jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d record;
  n record;
  changed_docs integer := 0;
  changed_nav integer := 0;
  opened integer := 0;
  closed integer := 0;
BEGIN
  FOR d IN
    SELECT x.*, i.nav_match_status AS old_status, i.nav_invoice_id AS old_nav
      FROM jsonb_to_recordset(coalesce(_documents, '[]'::jsonb)) AS x(
        id uuid, status text, nav_invoice_id uuid, score numeric, reason text, explanation jsonb,
        differences jsonb, duplicate_of uuid, company_id uuid)
      JOIN public.purchase_invoices i ON i.id = x.id AND i.organization_slug = _organization_slug
  LOOP
    IF d.old_status IS DISTINCT FROM d.status OR d.old_nav IS DISTINCT FROM d.nav_invoice_id THEN
      changed_docs := changed_docs + 1;
      INSERT INTO public.pi_reconciliation_events (organization_slug, company_id, invoice_id, nav_invoice_id, action, old_status, new_status, detail)
      VALUES (_organization_slug, d.company_id, d.id, d.nav_invoice_id, 'document_status', d.old_status, d.status,
              jsonb_build_object('score', d.score, 'reason', d.reason, 'previous_nav_invoice_id', d.old_nav));
    END IF;
    -- Field conflicts against a NAV record that is no longer the match are obsolete.
    UPDATE public.pi_invoice_field_provenance
       SET status = 'resolved', decision_note = 'Superseded: NAV match changed', updated_at = now()
     WHERE invoice_id = d.id AND status = 'open'
       AND (d.nav_invoice_id IS NULL OR nav_invoice_id IS DISTINCT FROM d.nav_invoice_id
            OR d.status NOT IN ('exact_match','probable_match','manual_resolution','correction_chain'));
    UPDATE public.purchase_invoices SET
      nav_match_status = d.status,
      nav_invoice_id = d.nav_invoice_id,
      nav_match_score = d.score,
      nav_match_reason = d.reason,
      nav_match_explanation = coalesce(d.explanation, '[]'::jsonb),
      nav_differences = coalesce(d.differences, '[]'::jsonb),
      nav_duplicate_of = d.duplicate_of,
      nav_last_checked_at = now()
    WHERE id = d.id;
  END LOOP;

  FOR n IN
    SELECT x.*, v.match_status AS old_status, v.matched_invoice_id AS old_doc, v.company_id AS v_company, v.hotel_id AS v_hotel
      FROM jsonb_to_recordset(coalesce(_nav, '[]'::jsonb)) AS x(
        id uuid, status text, document_id uuid, score numeric, reason text, explanation jsonb, duplicate_document_ids uuid[])
      JOIN public.pi_nav_invoices v ON v.id = x.id AND v.organization_slug = _organization_slug
  LOOP
    IF n.old_status IS DISTINCT FROM n.status OR n.old_doc IS DISTINCT FROM n.document_id THEN
      changed_nav := changed_nav + 1;
      INSERT INTO public.pi_reconciliation_events (organization_slug, company_id, invoice_id, nav_invoice_id, action, old_status, new_status, detail)
      VALUES (_organization_slug, n.v_company, n.document_id, n.id, 'nav_status', n.old_status, n.status,
              jsonb_build_object('reason', n.reason, 'previous_document_id', n.old_doc));
    END IF;
    UPDATE public.pi_nav_invoices SET
      match_status = n.status,
      matched_invoice_id = n.document_id,
      match_score = n.score,
      match_reason = n.reason,
      match_explanation = coalesce(n.explanation, '[]'::jsonb),
      duplicate_document_ids = coalesce(n.duplicate_document_ids, '{}'::uuid[]),
      matched_at = CASE WHEN n.document_id IS NOT NULL AND matched_invoice_id IS DISTINCT FROM n.document_id THEN now() ELSE matched_at END
    WHERE id = n.id;

    IF n.status = 'nav_only' THEN
      INSERT INTO public.pi_missing_document_followups (organization_slug, company_id, nav_invoice_id, hotel_id)
      VALUES (_organization_slug, n.v_company, n.id, n.v_hotel)
      ON CONFLICT (nav_invoice_id) DO NOTHING;
      IF FOUND THEN opened := opened + 1; END IF;
      -- A NAV record that lost its document re-opens its follow-up.
      UPDATE public.pi_missing_document_followups
         SET status = 'open', resolution = NULL, resolved_at = NULL, resolved_by = NULL
       WHERE nav_invoice_id = n.id AND status = 'resolved' AND resolution = 'document_matched';
    ELSE
      UPDATE public.pi_missing_document_followups
         SET status = 'resolved', resolved_at = now(),
             resolution = CASE WHEN n.status = 'not_expected' THEN 'not_required' ELSE 'document_matched' END
       WHERE nav_invoice_id = n.id AND status IN ('open','requested','in_progress');
      IF FOUND THEN closed := closed + 1; END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('documents_changed', changed_docs, 'nav_changed', changed_nav, 'followups_opened', opened, 'followups_closed', closed);
END $$;

CREATE OR REPLACE FUNCTION public.pi_apply_gap_fill(_organization_slug text, _items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  it record;
  f jsonb;
  inv public.purchase_invoices%ROWTYPE;
  applied integer := 0;
  skipped integer := 0;
BEGIN
  FOR it IN
    SELECT * FROM jsonb_to_recordset(coalesce(_items, '[]'::jsonb)) AS x(
      invoice_id uuid, nav_invoice_id uuid, fills jsonb, vat_lines jsonb, provenance jsonb)
  LOOP
    SELECT * INTO inv FROM public.purchase_invoices WHERE id = it.invoice_id AND organization_slug = _organization_slug;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- Provenance is always recorded; values are only applied to unapproved invoices.
    FOR f IN SELECT * FROM jsonb_array_elements(coalesce(it.provenance, '[]'::jsonb)) LOOP
      INSERT INTO public.pi_invoice_field_provenance (organization_slug, invoice_id, nav_invoice_id, field, ocr_value, nav_value, final_value, action, rule, material, status)
      VALUES (_organization_slug, it.invoice_id, it.nav_invoice_id, f->>'field', f->>'documentValue', f->>'navValue', f->>'finalValue',
              f->>'action', f->>'rule', coalesce((f->>'material')::boolean, false),
              CASE WHEN f->>'action' = 'fill' AND inv.approval_status <> 'approved' THEN 'applied'
                   WHEN f->>'action' = 'equivalent' THEN 'resolved' ELSE 'open' END)
      ON CONFLICT (invoice_id, field) DO UPDATE SET
        nav_invoice_id = EXCLUDED.nav_invoice_id, nav_value = EXCLUDED.nav_value, final_value = EXCLUDED.final_value,
        action = EXCLUDED.action, rule = EXCLUDED.rule, material = EXCLUDED.material,
        status = CASE WHEN pi_invoice_field_provenance.status IN ('accepted','rejected') THEN pi_invoice_field_provenance.status ELSE EXCLUDED.status END,
        updated_at = now();
    END LOOP;

    IF inv.approval_status = 'approved' OR it.fills IS NULL OR it.fills = '{}'::jsonb THEN
      skipped := skipped + CASE WHEN inv.approval_status = 'approved' THEN 1 ELSE 0 END;
    ELSE
      -- COALESCE keeps any value already on the document: never overwrite.
      UPDATE public.purchase_invoices SET
        merchant_tax_id = coalesce(merchant_tax_id, it.fills->>'merchant_tax_id'),
        merchant_name = coalesce(merchant_name, it.fills->>'merchant_name'),
        merchant_address = coalesce(merchant_address, it.fills->>'merchant_address'),
        merchant_bank_account = coalesce(merchant_bank_account, it.fills->>'merchant_bank_account'),
        buyer_tax_id = coalesce(buyer_tax_id, it.fills->>'buyer_tax_id'),
        buyer_name = coalesce(buyer_name, it.fills->>'buyer_name'),
        buyer_company_id = coalesce(buyer_company_id, (it.fills->>'buyer_company_id')::uuid),
        invoice_number = coalesce(invoice_number, it.fills->>'invoice_number'),
        invoice_date = coalesce(invoice_date, (it.fills->>'invoice_date')::date),
        performance_date = coalesce(performance_date, (it.fills->>'performance_date')::date),
        due_date = coalesce(due_date, (it.fills->>'due_date')::date),
        payment_method = coalesce(payment_method, it.fills->>'payment_method'),
        currency = CASE WHEN it.fills ? 'currency' AND coalesce(currency_source, 'document') = 'default' THEN it.fills->>'currency' ELSE currency END,
        currency_source = CASE WHEN it.fills ? 'currency' AND coalesce(currency_source, 'document') = 'default' THEN 'nav' ELSE currency_source END,
        net_amount = coalesce(net_amount, (it.fills->>'net_amount')::numeric),
        total_vat_amount = coalesce(total_vat_amount, (it.fills->>'total_vat_amount')::numeric),
        total_amount = coalesce(total_amount, (it.fills->>'total_amount')::numeric)
      WHERE id = it.invoice_id;
      applied := applied + 1;
    END IF;

    IF inv.approval_status <> 'approved' AND it.vat_lines IS NOT NULL AND jsonb_array_length(it.vat_lines) > 0
       AND NOT EXISTS (SELECT 1 FROM public.purchase_invoice_vat_lines WHERE invoice_id = it.invoice_id) THEN
      INSERT INTO public.purchase_invoice_vat_lines (invoice_id, vat_kind, vat_rate, vat_base, vat_amount)
      SELECT it.invoice_id, l->>'vat_kind', coalesce((l->>'vat_rate')::numeric, 0), coalesce((l->>'vat_base')::numeric, 0), coalesce((l->>'vat_amount')::numeric, 0)
        FROM jsonb_array_elements(it.vat_lines) l;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('applied', applied, 'skipped_approved', skipped);
END $$;
REVOKE ALL ON FUNCTION public.pi_apply_reconciliation(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pi_apply_gap_fill(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_apply_reconciliation(text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pi_apply_gap_fill(text, jsonb) TO service_role;

-- One reconciliation at a time per organization; requests that arrive while a
-- run is in progress are coalesced into exactly one follow-up run.
CREATE TABLE IF NOT EXISTS public.pi_reconcile_state (
  organization_slug text PRIMARY KEY,
  lock_token uuid,
  lock_until timestamptz,
  requested_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text CHECK (last_status IS NULL OR last_status IN ('completed','failed')),
  last_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text
);
ALTER TABLE public.pi_reconcile_state ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pi_reconcile_state TO authenticated;
GRANT ALL ON public.pi_reconcile_state TO service_role;
DROP POLICY IF EXISTS pi_reconcile_state_read ON public.pi_reconcile_state;
CREATE POLICY pi_reconcile_state_read ON public.pi_reconcile_state FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_module_access());

CREATE OR REPLACE FUNCTION public.pi_claim_reconcile(_organization_slug text, _lock_token uuid, _minutes integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE claimed integer;
BEGIN
  INSERT INTO public.pi_reconcile_state (organization_slug, requested_at)
  VALUES (_organization_slug, now())
  ON CONFLICT (organization_slug) DO UPDATE SET requested_at = now();
  UPDATE public.pi_reconcile_state
     SET lock_token = _lock_token, lock_until = now() + make_interval(mins => greatest(1, _minutes)),
         last_started_at = now(), requested_at = NULL
   WHERE organization_slug = _organization_slug AND (lock_until IS NULL OR lock_until < now());
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN claimed > 0;
END $$;

-- Releases the lock; returns true when another request arrived during the run.
CREATE OR REPLACE FUNCTION public.pi_release_reconcile(_organization_slug text, _lock_token uuid, _status text, _summary jsonb, _error text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE pending boolean;
BEGIN
  UPDATE public.pi_reconcile_state
     SET lock_token = NULL, lock_until = NULL, last_finished_at = now(),
         last_status = _status, last_summary = coalesce(_summary, '{}'::jsonb), last_error = left(_error, 500)
   WHERE organization_slug = _organization_slug AND lock_token = _lock_token
  RETURNING requested_at IS NOT NULL INTO pending;
  RETURN coalesce(pending, false);
END $$;
REVOKE ALL ON FUNCTION public.pi_claim_reconcile(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pi_release_reconcile(text, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pi_claim_reconcile(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.pi_release_reconcile(text, uuid, text, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 14. Read RPCs for the module UI (SECURITY INVOKER → RLS applies).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pi_reconciliation_summary(_company_id uuid DEFAULT NULL, _from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS TABLE (side text, status text, invoice_count bigint, currency text, gross_total numeric)
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT 'document'::text, i.nav_match_status, count(*), i.currency, coalesce(sum(i.total_amount), 0)
    FROM public.purchase_invoices i
   WHERE (_company_id IS NULL OR i.buyer_company_id = _company_id)
     AND (_from IS NULL OR i.invoice_date >= _from) AND (_to IS NULL OR i.invoice_date <= _to)
   GROUP BY i.nav_match_status, i.currency
  UNION ALL
  SELECT 'nav'::text, n.match_status, count(*), n.currency, coalesce(sum(n.gross_amount), 0)
    FROM public.pi_nav_invoices n
   WHERE (_company_id IS NULL OR n.company_id = _company_id)
     AND (_from IS NULL OR n.invoice_issue_date >= _from) AND (_to IS NULL OR n.invoice_issue_date <= _to)
   GROUP BY n.match_status, n.currency
$$;
REVOKE ALL ON FUNCTION public.pi_reconciliation_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pi_reconciliation_summary(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 15. Scheduled workers (pg_cron + pg_net, worker secret in Vault).
--     Every connection starts disabled, so scheduled runs do nothing until an
--     administrator saves, tests and enables NAV credentials.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regnamespace('vault') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'hotelcare_purchase_invoice_worker_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'hotelcare_purchase_invoice_worker_secret', 'HotelCare purchase-invoice NAV/OCR worker secret');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_purchase_invoice_worker_secret()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'hotelcare_purchase_invoice_worker_secret' LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_purchase_invoice_worker_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchase_invoice_worker_secret() TO service_role;

DO $$
DECLARE
  job record;
  base text := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/';
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL THEN
    RAISE NOTICE 'pg_cron/pg_net unavailable; purchase-invoice workers not scheduled';
    RETURN;
  END IF;
  FOR job IN SELECT jobid FROM cron.job WHERE jobname IN ('hotelcare-nav-sync','hotelcare-pi-ocr-recovery','hotelcare-pi-daily-summary') LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
  PERFORM cron.schedule('hotelcare-nav-sync', '*/30 * * * *', format($job$
    select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'hotelcare_purchase_invoice_worker_secret' limit 1)),
      body := jsonb_build_object('trigger','schedule'), timeout_milliseconds := 150000);
  $job$, base || 'nav-sync'));
  PERFORM cron.schedule('hotelcare-pi-ocr-recovery', '*/10 * * * *', format($job$
    select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'hotelcare_purchase_invoice_worker_secret' limit 1)),
      body := jsonb_build_object('mode','worker'), timeout_milliseconds := 150000);
  $job$, base || 'process-purchase-invoice'));
  PERFORM cron.schedule('hotelcare-pi-daily-summary', '15 6 * * *', format($job$
    select net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-worker-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'hotelcare_purchase_invoice_worker_secret' limit 1)),
      body := jsonb_build_object('trigger','schedule'), timeout_milliseconds := 120000);
  $job$, base || 'pi-daily-summary'));
END;
$$;

CREATE TABLE IF NOT EXISTS public.pi_daily_summary_log (
  organization_slug text NOT NULL,
  sent_on date NOT NULL,
  fingerprint text NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  exception_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_slug, sent_on)
);
ALTER TABLE public.pi_daily_summary_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pi_daily_summary_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pi_daily_summary_log TO service_role;
