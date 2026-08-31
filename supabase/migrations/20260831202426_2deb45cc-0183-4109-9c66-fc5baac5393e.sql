ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS standard_revenue_bi_price_cents integer NOT NULL DEFAULT 1900,
  ADD COLUMN IF NOT EXISTS standard_revenue_automation_price_cents integer NOT NULL DEFAULT 2900,
  ADD COLUMN IF NOT EXISTS standard_operations_price_cents integer NOT NULL DEFAULT 800,
  ADD COLUMN IF NOT EXISTS early_bird_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS early_bird_label text NOT NULL DEFAULT 'Early bird',
  ADD COLUMN IF NOT EXISTS early_bird_note text NOT NULL DEFAULT 'Founding-partner pricing, locked for 12 months from activation.',
  ADD COLUMN IF NOT EXISTS early_bird_ends_at date,
  ADD COLUMN IF NOT EXISTS grace_days integer NOT NULL DEFAULT 14;