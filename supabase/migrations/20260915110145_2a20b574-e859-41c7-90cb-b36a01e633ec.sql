CREATE TABLE public.billing_module_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text,
  scope_key text GENERATED ALWAYS AS (COALESCE(hotel_id, '__org__')) STORED,
  module text NOT NULL,
  pricing_mode text NOT NULL DEFAULT 'inherit',
  price_cents integer NOT NULL DEFAULT 0,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_module_overrides_unique UNIQUE (organization_slug, scope_key, module)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_module_overrides TO authenticated;
GRANT ALL ON public.billing_module_overrides TO service_role;

ALTER TABLE public.billing_module_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage module overrides"
ON public.billing_module_overrides
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_super_admin OR p.role::text = 'admin')))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_super_admin OR p.role::text = 'admin')));

CREATE TABLE public.billing_access_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text,
  scope_key text GENERATED ALWAYS AS (COALESCE(hotel_id, '__org__')) STORED,
  bypass_billing boolean NOT NULL DEFAULT false,
  reason text,
  expires_at timestamptz,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_access_overrides_unique UNIQUE (organization_slug, scope_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_access_overrides TO authenticated;
GRANT ALL ON public.billing_access_overrides TO service_role;

ALTER TABLE public.billing_access_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage access overrides"
ON public.billing_access_overrides
FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_super_admin OR p.role::text = 'admin')))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND (p.is_super_admin OR p.role::text = 'admin')));

CREATE INDEX idx_billing_module_overrides_slug ON public.billing_module_overrides (organization_slug);
CREATE INDEX idx_billing_access_overrides_slug ON public.billing_access_overrides (organization_slug);

CREATE TRIGGER update_billing_module_overrides_updated_at
BEFORE UPDATE ON public.billing_module_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_billing_access_overrides_updated_at
BEFORE UPDATE ON public.billing_access_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();