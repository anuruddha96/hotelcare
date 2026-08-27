ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS max_daily_increase_pct numeric NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS max_increase_pct numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS event_uplift_once_per_day boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS market_ceiling_multiple numeric NOT NULL DEFAULT 1.4,
  ADD COLUMN IF NOT EXISTS manual_override_ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS manual_override_review_hours integer NOT NULL DEFAULT 24;

ALTER TABLE public.revenue_pickup_automation_actions
  ADD COLUMN IF NOT EXISTS above_market boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS market_median numeric;