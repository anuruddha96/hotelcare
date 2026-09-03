-- Separate minimum-stay observation from live Previo publishing.
-- The automation remains enabled so it can evaluate and record decisions hourly,
-- while `min_stay_automation_live = false` guarantees no restriction writes.

alter table public.revenue_pickup_automation_rules
  add column if not exists min_stay_automation_live boolean not null default false,
  add column if not exists min_stay_shadow_started_at timestamptz,
  add column if not exists min_stay_live_activated_at timestamptz;

comment on column public.revenue_pickup_automation_rules.min_stay_automation_live
  is 'When true, smart minimum-stay proposals may be published to the PMS. False is shadow-only observation.';

comment on column public.revenue_pickup_automation_rules.min_stay_shadow_started_at
  is 'Timestamp when the current minimum-stay shadow observation period started.';

comment on column public.revenue_pickup_automation_rules.min_stay_live_activated_at
  is 'Timestamp when supervised live minimum-stay publishing was activated.';
