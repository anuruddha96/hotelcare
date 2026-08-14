DROP INDEX IF EXISTS public.revenue_automation_scheduled_action_uidx;

CREATE UNIQUE INDEX revenue_automation_scheduled_action_uidx
ON public.revenue_pickup_automation_actions (
  hotel_id,
  stay_date,
  obk_id,
  occupancy,
  rule_version,
  schedule_slot,
  local_business_date
);