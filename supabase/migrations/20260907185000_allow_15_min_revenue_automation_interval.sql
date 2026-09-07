-- Keep the database constraint aligned with the visible Price Automation cadence options.
-- The UI offers 15 and 30 minute checks; Engine V2 schedules from the saved
-- evaluation_interval_minutes value, so the database must accept the same range.
alter table public.revenue_pickup_automation_rules
  drop constraint if exists rpar_eval_interval_bounds;

alter table public.revenue_pickup_automation_rules
  add constraint rpar_eval_interval_bounds
  check (evaluation_interval_minutes >= 15 and evaluation_interval_minutes <= 1440);
