ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS lead_bands_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS far_out_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS far_out_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS far_out_surcharge numeric NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS far_out_notify boolean NOT NULL DEFAULT true;