-- Hotel Ottofiori: conversion-first pricing without sacrificing scarcity yield.
-- ADR remains a KPI/guard, but a weak stay month may no longer freeze every
-- markdown. Manual edits are protected long enough to settle, not for a full
-- selling day. Far-out synthetic top-ups are removed so events/market/pickup
-- provide the evidence for premiums.

update public.revenue_pickup_automation_rules
set month_pace_guard_enabled = false,
    manual_hold_hours = 6,
    max_markdowns_per_day = 3,
    far_out_floor_topup_enabled = false,
    far_out_surcharge = 0,
    window_rules = '[
      {"id":"w0_2","min_days_out":0,"max_days_out":2,"no_pickup_wait_hours":4,"max_daily_decrease":15,"max_daily_increase":8,"min_hours_between_decreases":0,"require_above_anchor":false},
      {"id":"w3_7","min_days_out":3,"max_days_out":5,"no_pickup_wait_hours":4,"max_daily_decrease":12,"max_daily_increase":8,"min_hours_between_decreases":0,"require_above_anchor":false},
      {"id":"w3_7","min_days_out":6,"max_days_out":7,"no_pickup_wait_hours":6,"max_daily_decrease":10,"max_daily_increase":8,"min_hours_between_decreases":0,"require_above_anchor":false},
      {"id":"w8_30","min_days_out":8,"max_days_out":14,"no_pickup_wait_hours":8,"max_daily_decrease":12,"max_daily_increase":8,"min_hours_between_decreases":2,"require_above_anchor":false},
      {"id":"w8_30","min_days_out":15,"max_days_out":31,"no_pickup_wait_hours":12,"max_daily_decrease":8,"max_daily_increase":8,"min_hours_between_decreases":6,"require_above_anchor":false},
      {"id":"w31_90","min_days_out":32,"max_days_out":60,"no_pickup_wait_hours":18,"max_daily_decrease":6,"max_daily_increase":8,"min_hours_between_decreases":18,"require_above_anchor":false},
      {"id":"w31_90","min_days_out":61,"max_days_out":90,"no_pickup_wait_hours":36,"max_daily_decrease":4,"max_daily_increase":8,"min_hours_between_decreases":36,"require_above_anchor":true},
      {"id":"w91_180","min_days_out":91,"max_days_out":180,"no_pickup_wait_hours":168,"max_daily_decrease":0,"max_daily_increase":8,"min_hours_between_decreases":72,"require_above_anchor":true},
      {"id":"w181_365","min_days_out":181,"max_days_out":null,"no_pickup_wait_hours":null,"max_daily_decrease":0,"max_daily_increase":10,"min_hours_between_decreases":0,"require_above_anchor":true}
    ]'::jsonb,
    updated_at = now()
where hotel_id = 'ottofiori'
  and organization_slug = 'rdhotels';

update public.revenue_pace_targets
set target_occupancy_pct = case
      when min_days_out = 31 and max_days_out = 60 then 60
      when min_days_out = 61 and max_days_out = 90 then 40
      else target_occupancy_pct
    end,
    updated_at = now()
where hotel_id = 'ottofiori'
  and organization_slug = 'rdhotels'
  and ((min_days_out = 31 and max_days_out = 60)
    or (min_days_out = 61 and max_days_out = 90));
