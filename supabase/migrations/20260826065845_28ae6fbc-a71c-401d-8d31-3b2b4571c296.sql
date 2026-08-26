ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS final_window_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS final_window_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS final_window_allow_event_increase boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS final_window_abnormal_pickup_rooms integer NOT NULL DEFAULT 5;

ALTER TABLE public.competitor_properties
  ADD COLUMN IF NOT EXISTS last_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_scan_status text,
  ADD COLUMN IF NOT EXISTS last_scan_error text,
  ADD COLUMN IF NOT EXISTS last_scan_prices integer NOT NULL DEFAULT 0;