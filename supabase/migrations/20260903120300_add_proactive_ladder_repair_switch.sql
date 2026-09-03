-- Add a per-rule switch for proactive occupancy-ladder repairs.
-- Existing properties default to off: a guest-count cleanup must never become
-- an independent revenue decision. The shared publisher safety still protects
-- exact mappings and manager-submitted changes.

alter table public.revenue_pickup_automation_rules
  add column if not exists proactive_ladder_repair_enabled boolean not null default false;

update public.revenue_pickup_automation_rules
set proactive_ladder_repair_enabled = false
where hotel_id = 'ottofiori';
