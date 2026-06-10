
-- New columns for duplicate detection
ALTER TABLE public.purchase_invoices
  ADD COLUMN IF NOT EXISTS is_credit_note boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS buyer_name text,
  ADD COLUMN IF NOT EXISTS buyer_tax_id text,
  ADD COLUMN IF NOT EXISTS buyer_address text,
  ADD COLUMN IF NOT EXISTS buyer_company_id uuid;

-- Index for fast duplicate lookups
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_dedup
  ON public.purchase_invoices (organization_slug, merchant_tax_id, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_buyer_company
  ON public.purchase_invoices (organization_slug, buyer_company_id);

-- Buyer companies registry
CREATE TABLE IF NOT EXISTS public.invoice_buyer_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  name text NOT NULL,
  tax_id text,
  display_color text DEFAULT '#3b82f6',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, tax_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_buyer_companies TO authenticated;
GRANT ALL ON public.invoice_buyer_companies TO service_role;

ALTER TABLE public.invoice_buyer_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view buyer companies"
  ON public.invoice_buyer_companies
  FOR SELECT
  TO authenticated
  USING (organization_slug = public.pi_user_org());

CREATE POLICY "Admins manage buyer companies"
  ON public.invoice_buyer_companies
  FOR ALL
  TO authenticated
  USING (
    organization_slug = public.pi_user_org()
    AND public.pi_user_role() IN ('admin','top_management','top_management_manager','control_finance','back_office')
  )
  WITH CHECK (
    organization_slug = public.pi_user_org()
    AND public.pi_user_role() IN ('admin','top_management','top_management_manager','control_finance','back_office')
  );

-- FK after table exists
ALTER TABLE public.purchase_invoices
  ADD CONSTRAINT purchase_invoices_buyer_company_fk
  FOREIGN KEY (buyer_company_id) REFERENCES public.invoice_buyer_companies(id) ON DELETE SET NULL;

-- Admin delete policy on purchase_invoices
DROP POLICY IF EXISTS "Admins can delete invoices in their org" ON public.purchase_invoices;
CREATE POLICY "Admins can delete invoices in their org"
  ON public.purchase_invoices
  FOR DELETE
  TO authenticated
  USING (
    organization_slug = public.pi_user_org()
    AND public.pi_user_role() IN ('admin','top_management','top_management_manager')
  );

-- updated_at trigger for invoice_buyer_companies
CREATE OR REPLACE FUNCTION public.touch_invoice_buyer_companies_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_buyer_companies_updated_at ON public.invoice_buyer_companies;
CREATE TRIGGER trg_invoice_buyer_companies_updated_at
  BEFORE UPDATE ON public.invoice_buyer_companies
  FOR EACH ROW EXECUTE FUNCTION public.touch_invoice_buyer_companies_updated_at();
