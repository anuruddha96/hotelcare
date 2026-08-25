-- ============================================================
-- Purchase Invoice & Controlling upgrade (additive only)
-- ============================================================

-- ---------- normalisation helpers ----------
CREATE OR REPLACE FUNCTION public.pi_norm_tax_id(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    regexp_replace(upper(regexp_replace(coalesce(_raw, ''), '[^0-9A-Za-z]', '', 'g')), '^HU', ''),
    ''
  )
$$;

CREATE OR REPLACE FUNCTION public.pi_norm_doc_number(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(upper(regexp_replace(coalesce(_raw, ''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

-- ---------- Batch 2: legal entities ----------
ALTER TABLE public.invoice_buyer_companies
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS normalized_tax_id text GENERATED ALWAYS AS (public.pi_norm_tax_id(tax_id)) STORED;

UPDATE public.invoice_buyer_companies SET legal_name = name WHERE legal_name IS NULL;

-- Merge companies that are the same legal entity by normalized tax id.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT organization_slug, normalized_tax_id,
           (array_agg(id ORDER BY created_at))[1] AS keep_id,
           array_agg(id) AS all_ids
      FROM public.invoice_buyer_companies
     WHERE normalized_tax_id IS NOT NULL
     GROUP BY organization_slug, normalized_tax_id
    HAVING count(*) > 1
  LOOP
    UPDATE public.purchase_invoices
       SET buyer_company_id = r.keep_id
     WHERE buyer_company_id = ANY(r.all_ids)
       AND buyer_company_id <> r.keep_id;
    UPDATE public.invoice_buyer_companies
       SET is_active = false,
           notes = coalesce(notes || ' | ', '') || 'Merged into canonical entity ' || r.keep_id
     WHERE id = ANY(r.all_ids) AND id <> r.keep_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_buyer_companies_org_taxid_uidx
  ON public.invoice_buyer_companies (organization_slug, normalized_tax_id)
  WHERE normalized_tax_id IS NOT NULL AND is_active;

CREATE TABLE IF NOT EXISTS public.invoice_company_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.invoice_buyer_companies(id) ON DELETE CASCADE,
  organization_slug text NOT NULL,
  alias_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, alias_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_company_aliases TO authenticated;
GRANT ALL ON public.invoice_company_aliases TO service_role;
ALTER TABLE public.invoice_company_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ica_read" ON public.invoice_company_aliases FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org());
CREATE POLICY "ica_write" ON public.invoice_company_aliases FOR ALL TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance','back_office']))
  WITH CHECK (organization_slug = public.pi_user_org() AND public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance','back_office']));

CREATE TABLE IF NOT EXISTS public.invoice_company_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.invoice_buyer_companies(id) ON DELETE CASCADE,
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, hotel_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_company_properties TO authenticated;
GRANT ALL ON public.invoice_company_properties TO service_role;
ALTER TABLE public.invoice_company_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "icp_read" ON public.invoice_company_properties FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org());
CREATE POLICY "icp_write" ON public.invoice_company_properties FOR ALL TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance','back_office']))
  WITH CHECK (organization_slug = public.pi_user_org() AND public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance','back_office']));

-- ---------- Batch 2: cost centres ----------
CREATE TABLE IF NOT EXISTS public.invoice_cost_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text,
  code text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_cost_centres TO authenticated;
GRANT ALL ON public.invoice_cost_centres TO service_role;
ALTER TABLE public.invoice_cost_centres ENABLE ROW LEVEL SECURITY;
CREATE POLICY "icc_read" ON public.invoice_cost_centres FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org());
CREATE POLICY "icc_write" ON public.invoice_cost_centres FOR ALL TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance','back_office']))
  WITH CHECK (organization_slug = public.pi_user_org() AND public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance','back_office']));

CREATE TRIGGER trg_icc_updated_at BEFORE UPDATE ON public.invoice_cost_centres
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.invoice_cost_centres (organization_slug, code, label, sort_order)
SELECT o.slug, c.code, c.label, c.sort_order
  FROM (SELECT DISTINCT organization_slug AS slug FROM public.profiles WHERE organization_slug IS NOT NULL) o
 CROSS JOIN (VALUES
    ('rooms','Rooms / Front Office',10),
    ('housekeeping','Housekeeping',20),
    ('fnb','Food & Beverage',30),
    ('breakfast','Breakfast',40),
    ('maintenance','Maintenance / Technical',50),
    ('utilities','Utilities',60),
    ('marketing','Marketing & Sales',70),
    ('admin','Administration',80),
    ('it','IT & Systems',90),
    ('hr','HR & Staff',100),
    ('finance','Finance & Controlling',110),
    ('other','Other / Unassigned',999)
 ) AS c(code,label,sort_order)
ON CONFLICT (organization_slug, code) DO NOTHING;

-- ---------- Batch 3: controlled expense categories ----------
INSERT INTO public.purchase_invoice_categories (organization_slug, code, label, sort_order)
SELECT o.slug, c.code, c.label, c.sort_order
  FROM (SELECT DISTINCT organization_slug AS slug FROM public.profiles WHERE organization_slug IS NOT NULL) o
 CROSS JOIN (VALUES
    ('food','Food purchases',10),
    ('beverage','Beverage purchases',20),
    ('cleaning_supplies','Cleaning supplies',30),
    ('guest_supplies','Guest supplies / amenities',40),
    ('linen','Linen & textiles',50),
    ('maintenance_materials','Maintenance materials',60),
    ('maintenance_services','Maintenance services',70),
    ('utilities_electricity','Utilities - electricity',80),
    ('utilities_gas','Utilities - gas',90),
    ('utilities_water','Utilities - water',100),
    ('telecom_it','Telecom & IT',110),
    ('office','Office & stationery',120),
    ('marketing','Marketing & advertising',130),
    ('commissions','OTA / commissions',140),
    ('professional_services','Professional services',150),
    ('insurance','Insurance',160),
    ('rent_leasing','Rent & leasing',170),
    ('taxes_fees','Taxes & official fees',180),
    ('staff_costs','Staff related costs',190),
    ('transport','Transport & logistics',200),
    ('equipment','Equipment & furniture',210),
    ('uncategorized','Uncategorized',999)
 ) AS c(code,label,sort_order)
ON CONFLICT DO NOTHING;

-- ---------- Batches 2-6: invoice columns ----------
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES public.invoice_cost_centres(id),
  ADD COLUMN IF NOT EXISTS expense_category_id uuid REFERENCES public.purchase_invoice_categories(id),
  ADD COLUMN IF NOT EXISTS company_property_mismatch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewer_notes text,
  ADD COLUMN IF NOT EXISTS reopened_by uuid,
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reopen_reason text,
  ADD COLUMN IF NOT EXISTS file_sha256 text,
  ADD COLUMN IF NOT EXISTS normalized_invoice_number text GENERATED ALWAYS AS (public.pi_norm_doc_number(invoice_number)) STORED,
  ADD COLUMN IF NOT EXISTS normalized_merchant_tax_id text GENERATED ALWAYS AS (public.pi_norm_tax_id(merchant_tax_id)) STORED;

ALTER TABLE public.purchase_invoices
  DROP CONSTRAINT IF EXISTS purchase_invoices_review_status_check,
  DROP CONSTRAINT IF EXISTS purchase_invoices_approval_status_check;
ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT purchase_invoices_review_status_check
    CHECK (review_status IN ('pending_review','reviewed','pending_approval')),
  ADD CONSTRAINT purchase_invoices_approval_status_check
    CHECK (approval_status IN ('none','approved','rejected'));

-- Verified invoices are reviewed, never auto-approved.
UPDATE public.purchase_invoices
   SET review_status = 'reviewed',
       reviewed_by = coalesce(reviewed_by, verified_by),
       reviewed_at = coalesce(reviewed_at, verified_at)
 WHERE is_verified = true AND review_status = 'pending_review';

-- ---------- Batch 4: audit log ----------
CREATE TABLE IF NOT EXISTS public.purchase_invoice_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  organization_slug text,
  user_id uuid,
  action text NOT NULL,
  field text,
  old_value text,
  new_value text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pi_audit_invoice_idx ON public.purchase_invoice_audit_log (invoice_id, created_at DESC);
GRANT SELECT, INSERT ON public.purchase_invoice_audit_log TO authenticated;
GRANT ALL ON public.purchase_invoice_audit_log TO service_role;
ALTER TABLE public.purchase_invoice_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pi_audit_read" ON public.purchase_invoice_audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_invoices i
                  WHERE i.id = invoice_id AND i.organization_slug = public.pi_user_org()));
CREATE POLICY "pi_audit_insert" ON public.purchase_invoice_audit_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM public.purchase_invoices i
                           WHERE i.id = invoice_id AND i.organization_slug = public.pi_user_org()));

-- Automatic workflow trail on every invoice change.
CREATE OR REPLACE FUNCTION public.pi_audit_invoice_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
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

DROP TRIGGER IF EXISTS trg_pi_audit ON public.purchase_invoices;
CREATE TRIGGER trg_pi_audit
  AFTER INSERT OR UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.pi_audit_invoice_changes();

-- ---------- Batch 5: finance access ----------
DO $$ BEGIN
  CREATE TYPE public.finance_profile AS ENUM ('none','uploader','reviewer','controller','chief_controller','management_read');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job_title text;

CREATE TABLE IF NOT EXISTS public.finance_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  organization_slug text NOT NULL,
  profile public.finance_profile NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_access TO authenticated;
GRANT ALL ON public.finance_access TO service_role;
ALTER TABLE public.finance_access ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.finance_access_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_access_id uuid NOT NULL REFERENCES public.finance_access(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.invoice_buyer_companies(id) ON DELETE CASCADE,
  UNIQUE (finance_access_id, company_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_access_companies TO authenticated;
GRANT ALL ON public.finance_access_companies TO service_role;
ALTER TABLE public.finance_access_companies ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.finance_access_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_access_id uuid NOT NULL REFERENCES public.finance_access(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  UNIQUE (finance_access_id, hotel_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.finance_access_properties TO authenticated;
GRANT ALL ON public.finance_access_properties TO service_role;
ALTER TABLE public.finance_access_properties ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fin_profile(_user_id uuid DEFAULT auth.uid())
RETURNS public.finance_profile
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT profile FROM public.finance_access WHERE user_id = _user_id), 'none'::public.finance_profile)
$$;

CREATE OR REPLACE FUNCTION public.fin_can_approve(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fin_profile(_user_id) IN ('controller','chief_controller')
$$;

-- true when the finance user's company/property scope covers this invoice
-- (no scope rows at all = whole organization)
CREATE OR REPLACE FUNCTION public.fin_scope_ok(_company_id uuid, _hotel_id text, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fa AS (SELECT id FROM public.finance_access WHERE user_id = _user_id)
  SELECT
    (NOT EXISTS (SELECT 1 FROM public.finance_access_companies c JOIN fa ON fa.id = c.finance_access_id)
      OR EXISTS (SELECT 1 FROM public.finance_access_companies c JOIN fa ON fa.id = c.finance_access_id
                  WHERE c.company_id = _company_id))
    AND
    (NOT EXISTS (SELECT 1 FROM public.finance_access_properties p JOIN fa ON fa.id = p.finance_access_id)
      OR EXISTS (SELECT 1 FROM public.finance_access_properties p JOIN fa ON fa.id = p.finance_access_id
                  WHERE p.hotel_id = _hotel_id))
$$;

CREATE OR REPLACE FUNCTION public.fin_is_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager'])
      OR public.fin_profile(_user_id) = 'chief_controller'
$$;

CREATE POLICY "fin_access_self_read" ON public.finance_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (organization_slug = public.pi_user_org() AND public.fin_is_admin()));
CREATE POLICY "fin_access_admin_write" ON public.finance_access FOR ALL TO authenticated
  USING (organization_slug = public.pi_user_org() AND public.fin_is_admin())
  WITH CHECK (organization_slug = public.pi_user_org() AND public.fin_is_admin());

CREATE POLICY "fin_companies_read" ON public.finance_access_companies FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.finance_access f WHERE f.id = finance_access_id
                  AND (f.user_id = auth.uid() OR (f.organization_slug = public.pi_user_org() AND public.fin_is_admin()))));
CREATE POLICY "fin_companies_write" ON public.finance_access_companies FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.finance_access f WHERE f.id = finance_access_id
                  AND f.organization_slug = public.pi_user_org() AND public.fin_is_admin()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.finance_access f WHERE f.id = finance_access_id
                  AND f.organization_slug = public.pi_user_org() AND public.fin_is_admin()));

CREATE POLICY "fin_properties_read" ON public.finance_access_properties FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.finance_access f WHERE f.id = finance_access_id
                  AND (f.user_id = auth.uid() OR (f.organization_slug = public.pi_user_org() AND public.fin_is_admin()))));
CREATE POLICY "fin_properties_write" ON public.finance_access_properties FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.finance_access f WHERE f.id = finance_access_id
                  AND f.organization_slug = public.pi_user_org() AND public.fin_is_admin()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.finance_access f WHERE f.id = finance_access_id
                  AND f.organization_slug = public.pi_user_org() AND public.fin_is_admin()));

CREATE TRIGGER trg_finance_access_updated_at BEFORE UPDATE ON public.finance_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Additive invoice policies for finance profiles (existing role policies stay in place).
CREATE POLICY "pi_finance_select" ON public.purchase_invoices FOR SELECT TO authenticated
  USING (organization_slug = public.pi_user_org()
         AND public.fin_profile() <> 'none'
         AND public.fin_scope_ok(buyer_company_id, hotel_id));

CREATE POLICY "pi_finance_update" ON public.purchase_invoices FOR UPDATE TO authenticated
  USING (organization_slug = public.pi_user_org()
         AND public.fin_profile() IN ('reviewer','controller','chief_controller')
         AND public.fin_scope_ok(buyer_company_id, hotel_id)
         AND (approval_status <> 'approved' OR public.fin_can_approve()))
  WITH CHECK (organization_slug = public.pi_user_org()
         AND public.fin_profile() IN ('reviewer','controller','chief_controller')
         AND public.fin_scope_ok(buyer_company_id, hotel_id)
         AND (approval_status = 'none' OR public.fin_can_approve()));

-- ---------- Batch 6 + 8: indexes ----------
CREATE INDEX IF NOT EXISTS pi_norm_invnum_idx ON public.purchase_invoices (organization_slug, normalized_invoice_number);
CREATE INDEX IF NOT EXISTS pi_norm_merchant_tax_idx ON public.purchase_invoices (organization_slug, normalized_merchant_tax_id);
CREATE INDEX IF NOT EXISTS pi_buyer_company_idx ON public.purchase_invoices (buyer_company_id);
CREATE INDEX IF NOT EXISTS pi_invoice_date_idx ON public.purchase_invoices (organization_slug, invoice_date DESC);
CREATE INDEX IF NOT EXISTS pi_org_hotel_idx ON public.purchase_invoices (organization_slug, hotel_id);
CREATE INDEX IF NOT EXISTS pi_workflow_idx ON public.purchase_invoices (organization_slug, review_status, approval_status);
CREATE INDEX IF NOT EXISTS pi_sha_idx ON public.purchase_invoices (organization_slug, file_sha256);
CREATE INDEX IF NOT EXISTS pi_merchant_name_trgm_idx ON public.purchase_invoices (organization_slug, merchant_name);