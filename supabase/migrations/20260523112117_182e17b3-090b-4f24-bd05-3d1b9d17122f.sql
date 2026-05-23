
-- 1. Extend user_role enum with back_office
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'back_office' AND enumtypid = 'public.user_role'::regtype) THEN
    ALTER TYPE public.user_role ADD VALUE 'back_office';
  END IF;
END$$;

-- 2. Helper: does the current user have purchase-invoice access at all?
CREATE OR REPLACE FUNCTION public.pi_user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role::text FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.pi_user_hotel()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT assigned_hotel FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.pi_user_org()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_slug FROM public.profiles WHERE id = auth.uid()
$$;

-- 3. Tables
CREATE TABLE public.purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),

  file_path text NOT NULL,
  file_mime text,
  file_size_bytes integer,

  status text NOT NULL DEFAULT 'uploaded',
    -- uploaded | processing | processed | failed | verified
  document_type text,
    -- invoice | receipt | not_invoice | unreadable
  error_code text,
  error_details jsonb,
  confidence_score numeric,
  needs_review boolean NOT NULL DEFAULT false,
  raw_text text,
  extraction_notes text,
  processing_notes text,

  merchant_name text,
  merchant_tax_id text,
  merchant_address text,
  merchant_country text DEFAULT 'HU',

  invoice_number text,
  invoice_date date,
  due_date date,
  performance_date date,

  currency text NOT NULL DEFAULT 'HUF',
  total_amount numeric,
  net_amount numeric,
  total_vat_amount numeric,
  bottle_deposit_amount numeric DEFAULT 0,

  expense_category text,
  payment_method text,
  notes text,

  is_verified boolean NOT NULL DEFAULT false,
  verified_by uuid REFERENCES public.profiles(id),
  verified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pi_org_hotel_date ON public.purchase_invoices(organization_slug, hotel_id, invoice_date DESC);
CREATE INDEX idx_pi_uploaded_by ON public.purchase_invoices(uploaded_by);
CREATE INDEX idx_pi_status ON public.purchase_invoices(status);

CREATE TABLE public.purchase_invoice_vat_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  vat_kind text NOT NULL,
    -- standard_27 | reduced_18 | reduced_5 | zero | aam_exempt | kba_reverse | eu_intra | export | foreign
  vat_rate numeric NOT NULL,
  vat_base numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pi_vat_invoice ON public.purchase_invoice_vat_lines(invoice_id);

CREATE TABLE public.purchase_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  name_original text,
  name_english text,
  item_code text,
  item_type text,
  quantity numeric,
  unit_price numeric,
  total_price numeric,
  vat_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pi_items_invoice ON public.purchase_invoice_items(invoice_id);

CREATE TABLE public.purchase_invoice_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, code)
);

CREATE TABLE public.user_tour_progress (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tour_key text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_key)
);

-- 4. updated_at triggers
CREATE TRIGGER pi_set_updated BEFORE UPDATE ON public.purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Enable RLS
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_vat_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tour_progress ENABLE ROW LEVEL SECURITY;

-- 6. Policies — purchase_invoices

-- Admin / top_management / control_finance: full access within org
CREATE POLICY "pi_full_admin_top_ctrl_select" ON public.purchase_invoices FOR SELECT TO authenticated
USING (
  pi_user_role() IN ('admin','top_management','control_finance')
  AND organization_slug = pi_user_org()
);
CREATE POLICY "pi_full_admin_top_ctrl_insert" ON public.purchase_invoices FOR INSERT TO authenticated
WITH CHECK (
  pi_user_role() IN ('admin','top_management','control_finance')
  AND organization_slug = pi_user_org()
  AND uploaded_by = auth.uid()
);
CREATE POLICY "pi_full_admin_top_ctrl_update" ON public.purchase_invoices FOR UPDATE TO authenticated
USING (
  pi_user_role() IN ('admin','top_management','control_finance')
  AND organization_slug = pi_user_org()
);
CREATE POLICY "pi_full_admin_delete" ON public.purchase_invoices FOR DELETE TO authenticated
USING (
  pi_user_role() IN ('admin','top_management')
  AND organization_slug = pi_user_org()
);

-- Back-office: full access within their hotel
CREATE POLICY "pi_backoffice_select" ON public.purchase_invoices FOR SELECT TO authenticated
USING (
  pi_user_role() = 'back_office'
  AND organization_slug = pi_user_org()
  AND (hotel_id IS NULL OR hotel_id = pi_user_hotel())
);
CREATE POLICY "pi_backoffice_insert" ON public.purchase_invoices FOR INSERT TO authenticated
WITH CHECK (
  pi_user_role() = 'back_office'
  AND organization_slug = pi_user_org()
  AND uploaded_by = auth.uid()
);
CREATE POLICY "pi_backoffice_update" ON public.purchase_invoices FOR UPDATE TO authenticated
USING (
  pi_user_role() = 'back_office'
  AND organization_slug = pi_user_org()
  AND (hotel_id IS NULL OR hotel_id = pi_user_hotel())
);

-- Reception / front_office: only their own uploads
CREATE POLICY "pi_reception_select_own" ON public.purchase_invoices FOR SELECT TO authenticated
USING (
  pi_user_role() IN ('reception','front_office')
  AND uploaded_by = auth.uid()
);
CREATE POLICY "pi_reception_insert" ON public.purchase_invoices FOR INSERT TO authenticated
WITH CHECK (
  pi_user_role() IN ('reception','front_office')
  AND organization_slug = pi_user_org()
  AND uploaded_by = auth.uid()
);
CREATE POLICY "pi_reception_update_own" ON public.purchase_invoices FOR UPDATE TO authenticated
USING (
  pi_user_role() IN ('reception','front_office')
  AND uploaded_by = auth.uid()
  AND is_verified = false
);

-- 7. Policies — VAT lines & items: piggy-back on parent invoice access
CREATE POLICY "pi_vat_all" ON public.purchase_invoice_vat_lines FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id));

CREATE POLICY "pi_items_all" ON public.purchase_invoice_items FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_invoices i WHERE i.id = invoice_id));

-- 8. Categories
CREATE POLICY "pi_cat_read" ON public.purchase_invoice_categories FOR SELECT TO authenticated
USING (organization_slug = pi_user_org());

CREATE POLICY "pi_cat_admin_write" ON public.purchase_invoice_categories FOR ALL TO authenticated
USING (organization_slug = pi_user_org() AND pi_user_role() IN ('admin','top_management'))
WITH CHECK (organization_slug = pi_user_org() AND pi_user_role() IN ('admin','top_management'));

-- 9. Tour progress — each user manages own row
CREATE POLICY "tour_read_own" ON public.user_tour_progress FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "tour_write_own" ON public.user_tour_progress FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY "tour_update_own" ON public.user_tour_progress FOR UPDATE TO authenticated
USING (user_id = auth.uid());
CREATE POLICY "tour_delete_own" ON public.user_tour_progress FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- 10. Default expense categories
INSERT INTO public.purchase_invoice_categories (organization_slug, code, label, sort_order)
SELECT slug, c.code, c.label, c.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('food_groceries', 'Food & Groceries', 10),
  ('cleaning_supplies', 'Cleaning Supplies', 20),
  ('linen_amenities', 'Linen & Amenities', 30),
  ('maintenance_repairs', 'Maintenance & Repairs', 40),
  ('utilities', 'Utilities', 50),
  ('office_supplies', 'Office Supplies', 60),
  ('marketing', 'Marketing', 70),
  ('professional_services', 'Professional Services', 80),
  ('technology', 'Technology & Subscriptions', 90),
  ('transportation', 'Transportation', 100),
  ('other', 'Other', 999)
) AS c(code, label, sort_order)
ON CONFLICT DO NOTHING;

-- 11. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('purchase-invoices', 'purchase-invoices', false)
ON CONFLICT (id) DO NOTHING;

-- 12. Storage policies — folder layout: {org_slug}/{hotel_id}/{invoice_id}/{filename}
CREATE POLICY "pi_storage_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'purchase-invoices'
  AND (
    pi_user_role() IN ('admin','top_management','control_finance')
    OR (pi_user_role() IN ('back_office') AND (storage.foldername(name))[1] = pi_user_org())
    OR (pi_user_role() IN ('reception','front_office') AND (storage.foldername(name))[1] = pi_user_org())
  )
);

CREATE POLICY "pi_storage_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'purchase-invoices'
  AND (storage.foldername(name))[1] = pi_user_org()
  AND pi_user_role() IN ('admin','top_management','control_finance','back_office','reception','front_office')
);

CREATE POLICY "pi_storage_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'purchase-invoices'
  AND pi_user_role() IN ('admin','top_management')
);
