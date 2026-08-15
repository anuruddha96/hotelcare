ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS cancellation_markdown_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancellation_wait_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE public.revenue_pickup_automation_actions
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS reason_detail text,
  ADD COLUMN IF NOT EXISTS hold_until timestamptz;