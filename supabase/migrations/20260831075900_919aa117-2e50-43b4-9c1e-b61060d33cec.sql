ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS pickup_increase_ladder jsonb,
  ADD COLUMN IF NOT EXISTS raise_on_any_pickup boolean NOT NULL DEFAULT true;