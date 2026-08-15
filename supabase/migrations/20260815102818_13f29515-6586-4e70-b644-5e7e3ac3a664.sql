ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS short_window_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS short_window_min_occupancy_pct numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS short_window_guard_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whole_number_prices boolean NOT NULL DEFAULT true;

ALTER TABLE public.revenue_pickup_automation_actions
  ADD COLUMN IF NOT EXISTS ai_reason text;