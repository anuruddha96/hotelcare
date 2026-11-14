-- Guest invoicing via Számlázz.hu Számla Agent.
-- The szamlazz-invoice edge function (service role) is the only writer;
-- hotel staff get read access through RLS. The Agent key lives in the
-- SZAMLAZZ_AGENT_KEY function secret and never reaches the browser.

CREATE TABLE IF NOT EXISTS public.guest_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('invoice','proforma','storno')),
  origin_invoice_id uuid REFERENCES public.guest_invoices(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'szamlazz',
  invoice_number text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','issued','failed')),
  currency text NOT NULL,
  payment_method text NOT NULL,
  due_date date,
  language text NOT NULL DEFAULT 'hu',
  buyer jsonb NOT NULL,
  lines jsonb NOT NULL,
  net_total numeric(14,2) NOT NULL DEFAULT 0,
  vat_total numeric(14,2) NOT NULL DEFAULT 0,
  gross_total numeric(14,2) NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  issued_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One provider invoice number per organization.
CREATE UNIQUE INDEX IF NOT EXISTS guest_invoices_number_unique
  ON public.guest_invoices(organization_slug, invoice_number)
  WHERE invoice_number IS NOT NULL;

-- One in-flight attempt per reservation: a second click waits for the first.
CREATE UNIQUE INDEX IF NOT EXISTS guest_invoices_one_pending_idx
  ON public.guest_invoices(reservation_id)
  WHERE status = 'pending';

-- A real invoice can only be stornoed once.
CREATE UNIQUE INDEX IF NOT EXISTS guest_invoices_one_storno_idx
  ON public.guest_invoices(origin_invoice_id)
  WHERE kind = 'storno' AND status IN ('pending','issued');

CREATE INDEX IF NOT EXISTS guest_invoices_reservation_idx
  ON public.guest_invoices(reservation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_invoices_org_hotel_idx
  ON public.guest_invoices(organization_slug, hotel_id, created_at DESC);

ALTER TABLE public.guest_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "PMS finance view guest invoices" ON public.guest_invoices;
CREATE POLICY "PMS finance view guest invoices"
ON public.guest_invoices FOR SELECT TO authenticated
USING (
  public.has_pms_access(auth.uid())
  AND public.can_access_reservation(auth.uid(), reservation_id)
);
-- No client INSERT/UPDATE/DELETE policies: the edge function uses service role.

CREATE OR REPLACE FUNCTION public.guest_invoices_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guest_invoices_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guest_invoices_touch_updated_at ON public.guest_invoices;
CREATE TRIGGER guest_invoices_touch_updated_at
BEFORE UPDATE ON public.guest_invoices
FOR EACH ROW EXECUTE FUNCTION public.guest_invoices_touch_updated_at();
