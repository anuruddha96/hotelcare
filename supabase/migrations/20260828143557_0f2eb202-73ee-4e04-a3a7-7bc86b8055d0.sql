ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS revenue_bi_price_cents integer NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS revenue_automation_price_cents integer NOT NULL DEFAULT 2200,
  ADD COLUMN IF NOT EXISTS maintenance_module_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS maintenance_pricing_mode text NOT NULL DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS maintenance_price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_percent numeric NOT NULL DEFAULT 27,
  ADD COLUMN IF NOT EXISTS billing_company_name text,
  ADD COLUMN IF NOT EXISTS billing_address_line1 text,
  ADD COLUMN IF NOT EXISTS billing_address_line2 text,
  ADD COLUMN IF NOT EXISTS billing_address_city text,
  ADD COLUMN IF NOT EXISTS billing_address_postal_code text,
  ADD COLUMN IF NOT EXISTS billing_address_country text,
  ADD COLUMN IF NOT EXISTS billing_tax_id text;

ALTER TABLE public.billing_settings DROP CONSTRAINT IF EXISTS billing_settings_maintenance_mode_chk;
ALTER TABLE public.billing_settings ADD CONSTRAINT billing_settings_maintenance_mode_chk
  CHECK (maintenance_pricing_mode = ANY (ARRAY['custom','per_room']));

ALTER TABLE public.billing_settings DROP CONSTRAINT IF EXISTS billing_settings_revenue_pricing_mode_chk;
ALTER TABLE public.billing_settings ADD CONSTRAINT billing_settings_revenue_pricing_mode_chk
  CHECK (revenue_pricing_mode = ANY (ARRAY['per_room','percent','percent_revenue']));

-- Seed the automation tier from the price that was already agreed per organization.
UPDATE public.billing_settings SET revenue_automation_price_cents = revenue_price_cents
  WHERE revenue_price_cents > 0;

-- Module keys: revenue splits into a Business Intelligence tier and a
-- BI + Automation tier; maintenance is sold on request.
ALTER TABLE public.module_subscriptions DROP CONSTRAINT IF EXISTS module_subscriptions_module_check;
UPDATE public.module_subscriptions SET module = 'revenue_automation' WHERE module = 'revenue';
ALTER TABLE public.module_subscriptions ADD CONSTRAINT module_subscriptions_module_check
  CHECK (module = ANY (ARRAY['revenue','revenue_bi','revenue_automation','operations','maintenance']));