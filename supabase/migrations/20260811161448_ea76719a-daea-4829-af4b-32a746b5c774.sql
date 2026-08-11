ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_daily_increase_per_date numeric NOT NULL DEFAULT 40;

CREATE UNIQUE INDEX IF NOT EXISTS revenue_pickup_automation_actions_unique_event
  ON public.revenue_pickup_automation_actions (hotel_id, stay_date, reservation_id, obk_id, occupancy);