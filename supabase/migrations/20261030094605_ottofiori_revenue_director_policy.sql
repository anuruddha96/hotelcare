-- Match the planner's human-price protection to the existing publisher guard.
-- A protected draft may predate its audit confirmation; neither source can be
-- silently ignored. AI reasons retain the existing explicit exclusion.
CREATE OR REPLACE FUNCTION public.revenue_manual_hold_state(
  p_hotel_id text, p_since timestamptz, p_sources text[]
)
RETURNS TABLE(stay_date date, hold_until timestamptz, hold_kind text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '20s'
AS $function$
  SELECT l.stay_date, l.locked_until, 'hard'::text
  FROM public.revenue_manual_locks l
  WHERE l.hotel_id = p_hotel_id AND l.locked_until > now()
  UNION ALL
  SELECT a.stay_date, max(a.performed_at), 'soft'::text
  FROM public.rate_change_audit a
  WHERE a.hotel_id = p_hotel_id AND a.performed_at >= p_since
    AND a.stay_date >= current_date AND a.source = ANY(p_sources)
  GROUP BY a.stay_date
  UNION ALL
  SELECT d.stay_date, max(d.created_at), 'soft'::text
  FROM public.revenue_rate_drafts d
  WHERE p_hotel_id = 'ottofiori' AND d.hotel_id = p_hotel_id
    AND d.organization_slug = 'rdhotels' AND d.stay_date >= current_date
    AND d.created_at >= greatest(p_since, now() - interval '24 hours')
    AND d.intent_source = 'manual' AND coalesce(d.decision_reason, '') !~ '^ai_'
    AND d.status NOT IN ('failed','superseded')
  GROUP BY d.stay_date
$function$;

-- Scope the commercial strategy to Ottofiori only. The 7-day cancellation
-- policy is a sell-through deadline, not an instruction to cut scarce dates.
UPDATE public.revenue_pickup_automation_rules
SET adr_target_eur = 140,
    monthly_adr_targets = '{"2026-11":140,"2026-12":155,"2027-01":130}'::jsonb,
    future_booking_window_days = 92,
    fill_window_days = 93,
    sold_out_occupancy_pct = 100,
    occupancy_lift_enabled = true,
    max_markdowns_per_day = 1,
    markdown_depth_pct = 12,
    manual_hold_hours = 24,
    booked_date_brake_hours = 12,
    rebook_window_hours = 24,
    direction_change_hours = 6,
    window_rules = '[
      {"id":"w0_2","min_days_out":0,"max_days_out":2,"max_daily_decrease":12,"max_daily_increase":8,"no_pickup_wait_hours":6,"min_hours_between_decreases":6,"require_above_anchor":false},
      {"id":"w3_7","min_days_out":3,"max_days_out":7,"max_daily_decrease":10,"max_daily_increase":10,"no_pickup_wait_hours":6,"min_hours_between_decreases":6,"require_above_anchor":false},
      {"id":"w8_30","min_days_out":8,"max_days_out":14,"max_daily_decrease":8,"max_daily_increase":10,"no_pickup_wait_hours":6,"min_hours_between_decreases":12,"require_above_anchor":false},
      {"id":"w8_30","min_days_out":15,"max_days_out":30,"max_daily_decrease":6,"max_daily_increase":12,"no_pickup_wait_hours":12,"min_hours_between_decreases":24,"require_above_anchor":false},
      {"id":"w31_90","min_days_out":31,"max_days_out":60,"max_daily_decrease":5,"max_daily_increase":12,"no_pickup_wait_hours":24,"min_hours_between_decreases":24,"require_above_anchor":false},
      {"id":"w31_90","min_days_out":61,"max_days_out":93,"max_daily_decrease":3,"max_daily_increase":15,"no_pickup_wait_hours":48,"min_hours_between_decreases":48,"require_above_anchor":false}
    ]'::jsonb,
    version = version + 1, updated_at = now()
WHERE hotel_id = 'ottofiori' AND organization_slug = 'rdhotels';

UPDATE public.revenue_pace_targets
SET target_occupancy_pct = CASE
      WHEN min_days_out <= 7 THEN 95
      WHEN min_days_out = 8 THEN 85
      WHEN min_days_out = 15 THEN 75
      WHEN min_days_out = 31 THEN 60
      WHEN min_days_out = 61 THEN 40
      ELSE target_occupancy_pct END,
    max_days_out = CASE WHEN min_days_out = 61 THEN 93 ELSE max_days_out END,
    min_days_out = CASE WHEN min_days_out = 91 THEN 94 ELSE min_days_out END,
    updated_at = now()
WHERE hotel_id = 'ottofiori' AND organization_slug = 'rdhotels';
