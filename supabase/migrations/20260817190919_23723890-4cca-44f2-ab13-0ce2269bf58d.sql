ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS far_out_floor_topup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS far_out_floor_topup_days integer NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS far_out_floor_topup_threshold numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS far_out_floor_topup_amount numeric NOT NULL DEFAULT 22;