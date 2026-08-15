ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS sold_out_guard_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sold_out_occupancy_pct numeric NOT NULL DEFAULT 100;