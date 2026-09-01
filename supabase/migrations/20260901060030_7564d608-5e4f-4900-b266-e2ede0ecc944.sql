ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS net_rate_factor_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS net_rate_factor_override numeric,
  ADD COLUMN IF NOT EXISTS month_pace_guard_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_adr_targets jsonb,
  ADD COLUMN IF NOT EXISTS occupancy_lift_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS occupancy_lift_ladder jsonb,
  ADD COLUMN IF NOT EXISTS booked_date_brake_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rebook_window_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_markdowns_per_day integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS markdown_depth_pct numeric NOT NULL DEFAULT 0;

UPDATE public.revenue_pickup_automation_rules
SET net_rate_factor_enabled = true,
    month_pace_guard_enabled = true,
    occupancy_lift_enabled = true,
    occupancy_lift_ladder = '[{"min_occupancy_pct":80,"min_days_out":7,"pct":8,"min_eur":10},{"min_occupancy_pct":70,"min_days_out":14,"pct":5,"min_eur":6},{"min_occupancy_pct":60,"min_days_out":30,"pct":3,"min_eur":4}]'::jsonb,
    booked_date_brake_hours = 72,
    rebook_window_hours = 24,
    max_markdowns_per_day = 1,
    markdown_depth_pct = 10,
    version = COALESCE(version, 0) + 1,
    updated_at = now()
WHERE hotel_id = 'ottofiori';