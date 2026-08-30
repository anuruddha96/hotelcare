ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS fill_mode_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fill_window_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS fill_max_total_drop_pct numeric NOT NULL DEFAULT 15;