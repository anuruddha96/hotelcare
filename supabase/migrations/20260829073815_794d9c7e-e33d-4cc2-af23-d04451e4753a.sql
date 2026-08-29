-- 1. Stay-date level decisions -------------------------------------------------
CREATE TABLE public.revenue_date_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  stay_date date NOT NULL,
  days_out integer NOT NULL,
  occupancy_pct numeric,
  rooms_sold integer,
  rooms_remaining integer,
  pickup_1h integer NOT NULL DEFAULT 0,
  pickup_6h integer NOT NULL DEFAULT 0,
  pickup_24h integer NOT NULL DEFAULT 0,
  pickup_48h integer NOT NULL DEFAULT 0,
  pickup_7d integer NOT NULL DEFAULT 0,
  cancellations_24h integer NOT NULL DEFAULT 0,
  pace_target_pct numeric,
  pace_gap_pct numeric,
  current_price integer,
  target_price integer,
  movement integer NOT NULL DEFAULT 0,
  direction text NOT NULL DEFAULT 'hold',
  decision_reason text NOT NULL DEFAULT 'hold',
  reason_detail text,
  event_signal jsonb,
  market_signal jsonb,
  manual_hold_until timestamptz,
  cap_applied numeric,
  status text NOT NULL DEFAULT 'shadow',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_date_decisions_direction_chk CHECK (direction IN ('increase','decrease','hold')),
  CONSTRAINT revenue_date_decisions_status_chk CHECK (status IN ('shadow','queued','published','verified','held','failed','blocked')),
  CONSTRAINT revenue_date_decisions_whole_eur CHECK (
    (current_price IS NULL OR current_price = round(current_price))
    AND (target_price IS NULL OR target_price = round(target_price))
  ),
  CONSTRAINT revenue_date_decisions_unique_run UNIQUE (run_id, stay_date)
);
CREATE INDEX idx_rdd_hotel_date ON public.revenue_date_decisions (hotel_id, stay_date DESC);
CREATE INDEX idx_rdd_hotel_created ON public.revenue_date_decisions (hotel_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_date_decisions TO authenticated;
GRANT ALL ON public.revenue_date_decisions TO service_role;
ALTER TABLE public.revenue_date_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view date decisions" ON public.revenue_date_decisions FOR SELECT TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users manage date decisions" ON public.revenue_date_decisions FOR ALL TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));

-- 2. Immutable booking discovery ledger ----------------------------------------
CREATE TABLE public.revenue_pickup_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  reservation_id text NOT NULL,
  stay_date date NOT NULL,
  pms_created_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  room_nights integer NOT NULL DEFAULT 1,
  cancelled_at timestamptz,
  increase_spent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_pickup_ledger_unique UNIQUE (hotel_id, reservation_id, stay_date)
);
CREATE INDEX idx_rpl_hotel_date ON public.revenue_pickup_ledger (hotel_id, stay_date);
CREATE INDEX idx_rpl_first_seen ON public.revenue_pickup_ledger (hotel_id, first_seen_at DESC);
GRANT SELECT ON public.revenue_pickup_ledger TO authenticated;
GRANT ALL ON public.revenue_pickup_ledger TO service_role;
ALTER TABLE public.revenue_pickup_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view pickup ledger" ON public.revenue_pickup_ledger FOR SELECT TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));

-- 3. Event application ledger ---------------------------------------------------
CREATE TABLE public.revenue_event_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  event_key text NOT NULL,
  stay_date date NOT NULL,
  impact text NOT NULL,
  uplift_eur integer NOT NULL DEFAULT 0,
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_event_applications_unique UNIQUE (hotel_id, event_key, stay_date),
  CONSTRAINT revenue_event_applications_whole CHECK (uplift_eur = round(uplift_eur))
);
GRANT SELECT ON public.revenue_event_applications TO authenticated;
GRANT ALL ON public.revenue_event_applications TO service_role;
ALTER TABLE public.revenue_event_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view event applications" ON public.revenue_event_applications FOR SELECT TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));

-- 4. Occupancy pace targets ------------------------------------------------------
CREATE TABLE public.revenue_pace_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  min_days_out integer NOT NULL,
  max_days_out integer NOT NULL,
  target_occupancy_pct numeric NOT NULL,
  month integer,
  weekday integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_pace_targets_unique UNIQUE (hotel_id, min_days_out, max_days_out, month, weekday)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_pace_targets TO authenticated;
GRANT ALL ON public.revenue_pace_targets TO service_role;
ALTER TABLE public.revenue_pace_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view pace targets" ON public.revenue_pace_targets FOR SELECT TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users manage pace targets" ON public.revenue_pace_targets FOR ALL TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));

INSERT INTO public.revenue_pace_targets (hotel_id, organization_slug, min_days_out, max_days_out, target_occupancy_pct) VALUES
  ('ottofiori','rdhotels',0,1,92),
  ('ottofiori','rdhotels',2,3,85),
  ('ottofiori','rdhotels',4,7,75),
  ('ottofiori','rdhotels',8,14,65),
  ('ottofiori','rdhotels',15,30,50),
  ('ottofiori','rdhotels',31,60,35),
  ('ottofiori','rdhotels',61,90,20),
  ('ottofiori','rdhotels',91,180,8),
  ('ottofiori','rdhotels',181,365,3);

-- 5. Automation run log ----------------------------------------------------------
CREATE TABLE public.revenue_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  rule_id uuid,
  mode text NOT NULL DEFAULT 'shadow',
  status text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  dates_evaluated integer NOT NULL DEFAULT 0,
  dates_increased integer NOT NULL DEFAULT 0,
  dates_decreased integer NOT NULL DEFAULT 0,
  dates_held integer NOT NULL DEFAULT 0,
  dates_blocked integer NOT NULL DEFAULT 0,
  cells_queued integer NOT NULL DEFAULT 0,
  cells_published integer NOT NULL DEFAULT 0,
  cells_verified integer NOT NULL DEFAULT 0,
  cells_failed integer NOT NULL DEFAULT 0,
  skip_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_automation_runs_status_chk CHECK (status IN ('in_progress','completed','failed','timed_out','stopped_stale_data'))
);
CREATE INDEX idx_rar_hotel_started ON public.revenue_automation_runs (hotel_id, started_at DESC);
GRANT SELECT ON public.revenue_automation_runs TO authenticated;
GRANT ALL ON public.revenue_automation_runs TO service_role;
ALTER TABLE public.revenue_automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view automation runs" ON public.revenue_automation_runs FOR SELECT TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));

-- 6. Floors and ceilings source of truth ------------------------------------------
CREATE TABLE public.revenue_price_floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  room_type_name text,
  occupancy integer,
  min_price integer,
  max_price integer,
  occupancy_supplement integer,
  is_global_safety_max boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_price_floors_whole CHECK (
    (min_price IS NULL OR min_price = round(min_price))
    AND (max_price IS NULL OR max_price = round(max_price))
    AND (occupancy_supplement IS NULL OR occupancy_supplement = round(occupancy_supplement))
  )
);
CREATE UNIQUE INDEX idx_rpf_scope ON public.revenue_price_floors
  (hotel_id, coalesce(room_type_name,'*'), coalesce(occupancy, -1));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_price_floors TO authenticated;
GRANT ALL ON public.revenue_price_floors TO service_role;
ALTER TABLE public.revenue_price_floors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Revenue users view price floors" ON public.revenue_price_floors FOR SELECT TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));
CREATE POLICY "Revenue users manage price floors" ON public.revenue_price_floors FOR ALL TO authenticated
  USING (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id))
  WITH CHECK (is_revenue_user(auth.uid()) AND user_can_access_hotel(auth.uid(), hotel_id));

INSERT INTO public.revenue_price_floors (hotel_id, organization_slug, room_type_name, occupancy, min_price, max_price, is_global_safety_max, notes)
VALUES ('ottofiori','rdhotels', NULL, 2, 110, 500, true, 'Reference (2-pax) minimum EUR 110, global safety ceiling EUR 500');

-- 7. Rule settings ------------------------------------------------------------------
ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS engine_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS shadow_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS gate_results jsonb,
  ADD COLUMN IF NOT EXISTS auto_pause_reason text,
  ADD COLUMN IF NOT EXISTS live_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS direction_change_hours integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS min_movement_eur integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS manual_hold_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS window_rules jsonb,
  ADD COLUMN IF NOT EXISTS market_validation jsonb,
  ADD COLUMN IF NOT EXISTS abnormal_pickup_threshold integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS run_budget_ms integer NOT NULL DEFAULT 30000;

ALTER TABLE public.revenue_pickup_automation_actions
  ADD COLUMN IF NOT EXISTS decision_id uuid REFERENCES public.revenue_date_decisions(id) ON DELETE SET NULL;

UPDATE public.revenue_pickup_automation_rules
SET engine_version = 2,
    mode = 'shadow',
    shadow_started_at = now(),
    auto_publish = false,
    whole_number_prices = true,
    sold_out_guard_enabled = true,
    abnormal_pickup_threshold = 2,
    min_movement_eur = 3,
    manual_hold_hours = 24,
    direction_change_hours = 6,
    market_validation = jsonb_build_object(
      'min_competitors', 4,
      'max_age_hours', 24,
      'median_cap_low_occ_pct', 125,
      'median_cap_high_occ_pct', 140
    ),
    updated_at = now()
WHERE hotel_id = 'ottofiori';