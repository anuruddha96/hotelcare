-- Owner's 5 November follow-up: quiet unprotected dates must step down after
-- several hours, even when a booking caused an increase earlier that day.
-- Events, strong occupancy/pickup, manager locks and absolute price floors stay protected.
UPDATE public.revenue_pickup_automation_rules
SET booked_date_brake_hours=4,rebook_window_hours=4,
 window_rules='[
 {"id":"w0_2","min_days_out":0,"max_days_out":2,"max_daily_decrease":12,"max_daily_increase":12,"no_pickup_wait_hours":2,"min_hours_between_decreases":2,"require_above_anchor":false},
 {"id":"w3_7","min_days_out":3,"max_days_out":7,"max_daily_decrease":10,"max_daily_increase":15,"no_pickup_wait_hours":3,"min_hours_between_decreases":3,"require_above_anchor":false},
 {"id":"w8_30","min_days_out":8,"max_days_out":14,"max_daily_decrease":8,"max_daily_increase":18,"no_pickup_wait_hours":4,"min_hours_between_decreases":3,"require_above_anchor":false},
 {"id":"w8_30","min_days_out":15,"max_days_out":30,"max_daily_decrease":6,"max_daily_increase":20,"no_pickup_wait_hours":4,"min_hours_between_decreases":3,"require_above_anchor":false},
 {"id":"w31_90","min_days_out":31,"max_days_out":60,"max_daily_decrease":6,"max_daily_increase":20,"no_pickup_wait_hours":6,"min_hours_between_decreases":3,"require_above_anchor":false},
 {"id":"w31_90","min_days_out":61,"max_days_out":120,"max_daily_decrease":6,"max_daily_increase":22,"no_pickup_wait_hours":6,"min_hours_between_decreases":3,"require_above_anchor":false}
 ]'::jsonb,
 version=version+1,updated_at=now()
WHERE hotel_id='ottofiori' AND organization_slug='rdhotels';
