-- One-time HotelCare collections: never linked to a Stripe Subscription or invoice.
-- Checkout requests and settlements are written only by service-role Edge Functions.
CREATE TABLE public.billing_one_time_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL REFERENCES public.organizations(slug),
  package_key text NOT NULL CHECK (package_key IN ('revenue','housekeeping')),
  description text NOT NULL,
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  net_cents bigint NOT NULL CHECK (net_cents > 0),
  vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
  gross_cents bigint NOT NULL CHECK (gross_cents = net_cents + vat_cents),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','needs_review')),
  billing_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  szamlazz_invoice_number text,
  invoiced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT only_invoice_settled_one_time_payment
    CHECK (szamlazz_invoice_number IS NULL OR (status = 'paid' AND paid_at IS NOT NULL))
);
-- One open Checkout per package and organization prevents accidental duplicate requests.
CREATE UNIQUE INDEX billing_one_time_pending_package_unique
  ON public.billing_one_time_payments(organization_slug, package_key)
  WHERE status = 'pending';
CREATE UNIQUE INDEX billing_one_time_invoice_unique
  ON public.billing_one_time_payments(organization_slug, szamlazz_invoice_number)
  WHERE szamlazz_invoice_number IS NOT NULL;
CREATE INDEX billing_one_time_payments_organization_idx
  ON public.billing_one_time_payments(organization_slug, created_at DESC);
ALTER TABLE public.billing_one_time_payments ENABLE ROW LEVEL SECURITY;
-- No client access policies: the authenticated admin calls billing-manage, and
-- signature-verified Stripe webhooks write settlements with service-role only.
