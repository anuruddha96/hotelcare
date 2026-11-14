-- Per-legal-entity Szamlazz.hu configurations. No client Data API access.
-- All mutations and reads are mediated by authenticated Edge functions.
CREATE TABLE IF NOT EXISTS public.invoice_issuers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL REFERENCES public.organizations(slug),
  legal_name text NOT NULL,
  tax_number text NOT NULL,
  zip text NOT NULL,
  city text NOT NULL,
  street_address text NOT NULL,
  billing_email text NOT NULL,
  bank_name text NOT NULL DEFAULT '',
  bank_account text NOT NULL DEFAULT '',
  reply_to_email text NOT NULL DEFAULT '',
  invoice_prefix text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'hu',
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','live')),
  connection_mode text NOT NULL DEFAULT 'own_account' CHECK (connection_mode IN ('own_account','delegated')),
  credential_ciphertext text,
  credential_iv text,
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_issuers_org_id_unique UNIQUE (id, organization_slug),
  CONSTRAINT invoice_issuers_prefix_valid CHECK (invoice_prefix = '' OR invoice_prefix ~ '^[A-Z0-9]{1,5}$')
);
CREATE INDEX IF NOT EXISTS invoice_issuers_org_idx ON public.invoice_issuers(organization_slug,legal_name);

CREATE TABLE IF NOT EXISTS public.invoice_hotel_issuers (
  organization_slug text NOT NULL REFERENCES public.organizations(slug),
  hotel_id text NOT NULL,
  issuer_id uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_slug,hotel_id),
  FOREIGN KEY (issuer_id,organization_slug)
    REFERENCES public.invoice_issuers(id,organization_slug) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS invoice_hotel_issuers_issuer_idx ON public.invoice_hotel_issuers(issuer_id);

ALTER TABLE public.guest_invoices
  ADD COLUMN IF NOT EXISTS issuer_id uuid REFERENCES public.invoice_issuers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS guest_invoices_issuer_idx ON public.guest_invoices(issuer_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.invoice_issuer_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_slug text NOT NULL,
  issuer_id uuid,
  hotel_id text,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('save','rotate_key','enable','disable','assign','unassign')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_issuer_audit_org_idx ON public.invoice_issuer_audit(organization_slug,created_at DESC);

ALTER TABLE public.invoice_issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_hotel_issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_issuer_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.invoice_issuers FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.invoice_hotel_issuers FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.invoice_issuer_audit FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.invoice_issuer_audit_id_seq FROM PUBLIC,anon,authenticated;

-- No anon/authenticated policies: server-only service role access.
-- A service-role edge function validates JWT, role, hotel permission and org on every call.