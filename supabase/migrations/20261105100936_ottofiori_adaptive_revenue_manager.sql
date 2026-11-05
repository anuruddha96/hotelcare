-- Ottofiori only: a rolling 120-day commercial plan includes all of February
-- today and always covers at least the required next 90 days.
UPDATE public.revenue_pickup_automation_rules
SET future_booking_window_days=120, fill_window_days=120,
 evaluation_interval_minutes=15, max_markdowns_per_day=4,
 markdown_depth_pct=25, fill_max_total_drop_pct=25,
 manual_hold_hours=4, booked_date_brake_hours=12, rebook_window_hours=12,
 direction_change_hours=3, min_movement_eur=1,
 sold_out_occupancy_pct=100,
 monthly_adr_targets=coalesce(monthly_adr_targets,'{}'::jsonb) || '{"2027-02":130}'::jsonb,
 window_rules='[
 {"id":"w0_2","min_days_out":0,"max_days_out":2,"max_daily_decrease":12,"max_daily_increase":12,"no_pickup_wait_hours":2,"min_hours_between_decreases":2,"require_above_anchor":false},
 {"id":"w3_7","min_days_out":3,"max_days_out":7,"max_daily_decrease":10,"max_daily_increase":15,"no_pickup_wait_hours":4,"min_hours_between_decreases":4,"require_above_anchor":false},
 {"id":"w8_30","min_days_out":8,"max_days_out":14,"max_daily_decrease":8,"max_daily_increase":18,"no_pickup_wait_hours":6,"min_hours_between_decreases":6,"require_above_anchor":false},
 {"id":"w8_30","min_days_out":15,"max_days_out":30,"max_daily_decrease":6,"max_daily_increase":20,"no_pickup_wait_hours":8,"min_hours_between_decreases":12,"require_above_anchor":false},
 {"id":"w31_90","min_days_out":31,"max_days_out":60,"max_daily_decrease":5,"max_daily_increase":20,"no_pickup_wait_hours":12,"min_hours_between_decreases":12,"require_above_anchor":false},
 {"id":"w31_90","min_days_out":61,"max_days_out":120,"max_daily_decrease":4,"max_daily_increase":22,"no_pickup_wait_hours":24,"min_hours_between_decreases":24,"require_above_anchor":false}
 ]'::jsonb,
 version=version+1,updated_at=now()
WHERE hotel_id='ottofiori' AND organization_slug='rdhotels';

UPDATE public.revenue_pace_targets
SET target_occupancy_pct=CASE WHEN min_days_out<=7 THEN 100
 WHEN min_days_out=8 THEN 90 WHEN min_days_out=15 THEN 80
 WHEN min_days_out=31 THEN 65 WHEN min_days_out=61 THEN 45
 ELSE target_occupancy_pct END,
 max_days_out=CASE WHEN min_days_out=61 THEN 120 ELSE max_days_out END,
 min_days_out=CASE WHEN min_days_out=94 THEN 121 ELSE min_days_out END,
 updated_at=now()
WHERE hotel_id='ottofiori' AND organization_slug='rdhotels';

-- Keep the scheduler's lease aligned with the Edge Function's interval.
-- Preserve the existing privileges, lock and fairness for every other hotel.
CREATE OR REPLACE FUNCTION public.claim_due_automation_rule()
RETURNS TABLE(hotel_id text,rule_id uuid,interval_minutes integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $function$
DECLARE v_row public.revenue_pickup_automation_rules%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM public.revenue_pickup_automation_rules
 WHERE is_enabled=true AND (next_run_at IS NULL OR next_run_at<=now())
 ORDER BY next_run_at NULLS FIRST,last_evaluated_at NULLS FIRST
 FOR UPDATE SKIP LOCKED LIMIT 1;
 IF v_row.id IS NULL THEN RETURN; END IF;
 UPDATE public.revenue_pickup_automation_rules
 SET next_run_at=now()+make_interval(mins=>GREATEST(
   CASE WHEN v_row.hotel_id='ottofiori' THEN 15 ELSE 60 END,
   v_row.evaluation_interval_minutes)),last_evaluated_at=now()
 WHERE id=v_row.id;
 RETURN QUERY SELECT v_row.hotel_id,v_row.id,v_row.evaluation_interval_minutes;
END;
$function$;
