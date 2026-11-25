-- Flexible commercial agreements for HotelCare modules.
--
-- These tables intentionally do NOT change hotel_configurations.is_active.
-- A billing-access bypass only affects the subscription/payment gate; it must
-- never activate/deactivate a property operationally or change PMS/housekeeping state.

CREATE TABLE IF NOT EXISTS public.billing_module_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL REFERENCES public.organizations(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  hotel_id text NULL,
  module text NOT NULL CHECK (module IN ('operations', 'revenue_bi', 'revenue_automation', 'maintenance')),
  pricing_mode text NOT NULL DEFAULT 'inherit' CHECK (pricing_mode IN ('inherit', 'per_room', 'fixed_monthly')),
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  scope_key text GENERATED ALWAYS AS (COALESCE(hotel_id, '__organization__')) STORED,
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_module_overrides_scope_module_key UNIQUE (organization_slug, scope_key, module)
);

CREATE INDEX IF NOT EXISTS billing_module_overrides_org_idx
  ON public.billing_module_overrides (organization_slug);
CREATE INDEX IF NOT EXISTS billing_module_overrides_hotel_idx
  ON public.billing_module_overrides (hotel_id)
  WHERE hotel_id IS NOT NULL;

ALTER TABLE public.billing_module_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.billing_module_overrides IS
  'Admin-only pricing overrides. hotel_id NULL means organization-wide. Hotel override wins over organization override; inherit falls back to legacy billing_settings.';
COMMENT ON COLUMN public.billing_module_overrides.pricing_mode IS
  'inherit = existing billing_settings; per_room = explicit room/month price; fixed_monthly = one fixed monthly module fee for the scope.';

CREATE TABLE IF NOT EXISTS public.billing_access_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL REFERENCES public.organizations(slug) ON UPDATE CASCADE ON DELETE CASCADE,
  hotel_id text NULL,
  scope_key text GENERATED ALWAYS AS (COALESCE(hotel_id, '__organization__')) STORED,
  bypass_billing boolean NOT NULL DEFAULT false,
  reason text NULL,
  expires_at timestamptz NULL,
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_access_overrides_scope_key UNIQUE (organization_slug, scope_key)
);

CREATE INDEX IF NOT EXISTS billing_access_overrides_org_idx
  ON public.billing_access_overrides (organization_slug);
CREATE INDEX IF NOT EXISTS billing_access_overrides_hotel_idx
  ON public.billing_access_overrides (hotel_id)
  WHERE hotel_id IS NOT NULL;

ALTER TABLE public.billing_access_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.billing_access_overrides IS
  'Admin-only subscription-gate bypass. It does not modify a hotel operational active state.';
COMMENT ON COLUMN public.billing_access_overrides.bypass_billing IS
  'When true (and not expired), payment/subscription gating is bypassed for the organization or hotel.';

-- No authenticated-browser policies are added. Reads/writes go through the
-- billing Edge Functions using the service role after an explicit admin check.
