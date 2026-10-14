-- Opt-in payment-only billing. No Stripe invoice/subscription objects are created.
-- Not deployed by this PR. The service-role backend is the only writer.
CREATE TABLE public.manual_billing_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL REFERENCES public.organizations(slug),
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','past_due','paused','needs_review','cancelled','expired')),
  stripe_checkout_session_id text UNIQUE,
  stripe_customer_id text,
  stripe_payment_method_id text,
  selections jsonb NOT NULL,
  items jsonb NOT NULL,
  currency text NOT NULL,
  net_cents bigint NOT NULL CHECK (net_cents >= 0),
  vat_cents bigint NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
  gross_cents bigint NOT NULL DEFAULT 0 CHECK (gross_cents >= 0),
  billing_fingerprint text,
  billing_tax_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  billing_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  vat_percent_snapshot numeric NOT NULL,
  next_charge_at timestamptz,
  current_period_end timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manual_billing_contracts_due_idx ON public.manual_billing_contracts(next_charge_at) WHERE status='active';

-- Reserve an entitlement before opening Checkout so concurrent checkouts cannot double-sell it.
CREATE TABLE public.manual_billing_scopes (
  hotel_id text NOT NULL,
  module text NOT NULL,
  contract_id uuid NOT NULL REFERENCES public.manual_billing_contracts(id) ON DELETE CASCADE,
  PRIMARY KEY (hotel_id, module)
);

CREATE TABLE public.manual_billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.manual_billing_contracts(id),
  organization_slug text NOT NULL REFERENCES public.organizations(slug),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  payment_source text NOT NULL CHECK(payment_source IN ('checkout','renewal')),
  stripe_payment_intent_id text UNIQUE,
  status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','paid','failed','requires_action','needs_review')),
  currency text NOT NULL,
  net_cents bigint NOT NULL,
  vat_cents bigint NOT NULL,
  gross_cents bigint NOT NULL,
  paid_at timestamptz,
  billing_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  szamlazz_invoice_number text,
  invoiced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contract_id, period_start)
);
CREATE UNIQUE INDEX manual_billing_invoice_number_unique
  ON public.manual_billing_payments(organization_slug,szamlazz_invoice_number)
  WHERE szamlazz_invoice_number IS NOT NULL;
CREATE INDEX manual_billing_payments_org_idx ON public.manual_billing_payments(organization_slug,created_at DESC);

ALTER TABLE public.manual_billing_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_billing_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_billing_payments ENABLE ROW LEVEL SECURITY;
-- No client RLS policies: billing-manage and the protected webhook/worker use service role.

CREATE OR REPLACE FUNCTION public.manual_billing_claim_due(_limit integer DEFAULT 10)
RETURNS SETOF public.manual_billing_payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  rec public.manual_billing_contracts%ROWTYPE;
  claimed public.manual_billing_payments%ROWTYPE;
BEGIN
  IF _limit < 1 OR _limit > 50 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
  FOR rec IN
    SELECT * FROM public.manual_billing_contracts
    WHERE status = 'active' AND cancel_at_period_end = false AND next_charge_at <= now()
      AND stripe_customer_id IS NOT NULL AND stripe_payment_method_id IS NOT NULL
    ORDER BY next_charge_at
    LIMIT _limit FOR UPDATE SKIP LOCKED
  LOOP
    -- A failed or ambiguous payment must be reviewed, not charged a second time.
    INSERT INTO public.manual_billing_payments(
      contract_id,organization_slug,period_start,period_end,payment_source,status,
      currency,net_cents,vat_cents,gross_cents,billing_details
    ) VALUES (
      rec.id,rec.organization_slug,rec.next_charge_at,
      rec.next_charge_at + interval '1 month','renewal','processing',
      rec.currency,rec.net_cents,rec.vat_cents,rec.gross_cents,rec.billing_details
    ) ON CONFLICT (contract_id,period_start) DO NOTHING RETURNING * INTO claimed;
    IF FOUND THEN
      UPDATE public.manual_billing_contracts SET status='paused',updated_at=now() WHERE id=rec.id;
      RETURN NEXT claimed;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.manual_billing_claim_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manual_billing_claim_due(integer) TO service_role;
