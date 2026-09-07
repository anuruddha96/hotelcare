alter table public.revenue_pickup_automation_rules
  add column if not exists date_column_lockstep_enabled boolean not null default false;

comment on column public.revenue_pickup_automation_rules.date_column_lockstep_enabled is
  'When enabled, Engine V2 moves every room type and guest level on a stay date by the same EUR amount; room-type bounds do not freeze the date, and only the hotel absolute safety boundary can stop the column.';
