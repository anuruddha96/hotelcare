ALTER TABLE public.revenue_pickup_automation_actions
  DROP CONSTRAINT IF EXISTS revenue_pickup_automation_actions_decision_type_check;
ALTER TABLE public.revenue_pickup_automation_actions
  ADD CONSTRAINT revenue_pickup_automation_actions_decision_type_check
  CHECK (decision_type = ANY (ARRAY['positive_pickup'::text,'no_pickup_markdown'::text,'smart_strong_demand'::text,'cancellation_cooldown'::text,'far_out_floor_topup'::text]));