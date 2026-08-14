-- 1. Scheduling + safety fields on the automation rule -----------------------
ALTER TABLE public.revenue_pickup_automation_rules
  ADD COLUMN IF NOT EXISTS evaluation_interval_minutes integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_evaluated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_successful_evaluation_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_evaluation_status text,
  ADD COLUMN IF NOT EXISTS last_evaluation_error text,
  ADD COLUMN IF NOT EXISTS protect_high_occupancy boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS markdown_max_occupancy_pct numeric NOT NULL DEFAULT 88,
  ADD COLUMN IF NOT EXISTS manual_markdown_hold_hours integer NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rpar_eval_interval_bounds'
  ) THEN
    ALTER TABLE public.revenue_pickup_automation_rules
      ADD CONSTRAINT rpar_eval_interval_bounds
      CHECK (evaluation_interval_minutes >= 60 AND evaluation_interval_minutes <= 1440);
  END IF;
END $$;

-- Fixed decimal markdown amounts (e.g. 0.50) must survive.
ALTER TABLE public.revenue_pickup_automation_rules
  ALTER COLUMN no_pickup_decrease SET DEFAULT 0.50;

-- 2. Backward-safe backfill. Enabled/disabled state is NEVER touched, and the
--    first due time is placed in the near future, staggered per property, so
--    deployment cannot trigger a catch-up cascade.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY hotel_id) AS rn
  FROM public.revenue_pickup_automation_rules
  WHERE is_enabled = true
)
UPDATE public.revenue_pickup_automation_rules r
   SET evaluation_interval_minutes = 60,
       next_run_at = now() + make_interval(mins => (5 + (o.rn - 1) * 7)::int)
  FROM ordered o
 WHERE r.id = o.id
   AND r.next_run_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rpar_due
  ON public.revenue_pickup_automation_rules (is_enabled, next_run_at);

-- 3. Global publisher lease -------------------------------------------------
ALTER TABLE public.revenue_engine_config
  ADD COLUMN IF NOT EXISTS publisher_lock_hotel text,
  ADD COLUMN IF NOT EXISTS publisher_lock_at timestamptz;

-- 4. Durable intent metadata on drafts / runs --------------------------------
ALTER TABLE public.revenue_rate_drafts
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS intent_source text,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid;

ALTER TABLE public.revenue_rate_push_runs
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 50;

CREATE INDEX IF NOT EXISTS idx_drafts_active_cell
  ON public.revenue_rate_drafts (hotel_id, stay_date, room_type_name, occupancy)
  WHERE status IN ('draft', 'failed');

CREATE INDEX IF NOT EXISTS idx_push_runs_queue
  ON public.revenue_rate_push_runs (status, priority, created_at);

-- 5. Global publisher lock RPCs ---------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_publisher_lock(p_hotel text, p_stale_minutes integer DEFAULT 15)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ok boolean;
BEGIN
  UPDATE public.revenue_engine_config
     SET publisher_lock_hotel = p_hotel,
         publisher_lock_at = now()
   WHERE id = 'global'
     AND (publisher_lock_at IS NULL
          OR publisher_lock_hotel = p_hotel
          OR publisher_lock_at < now() - make_interval(mins => GREATEST(1, p_stale_minutes)))
  RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_publisher_lock(p_hotel text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.revenue_engine_config
     SET publisher_lock_hotel = NULL, publisher_lock_at = NULL
   WHERE id = 'global' AND publisher_lock_hotel = p_hotel;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_publisher_lock(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_publisher_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_publisher_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_publisher_lock(text) TO service_role;

-- 6. Scheduler: hand out exactly ONE due property per cycle -------------------
CREATE OR REPLACE FUNCTION public.claim_due_automation_rule()
RETURNS TABLE(hotel_id text, rule_id uuid, interval_minutes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_row public.revenue_pickup_automation_rules%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.revenue_pickup_automation_rules
   WHERE is_enabled = true
     AND (next_run_at IS NULL OR next_run_at <= now())
   ORDER BY next_run_at NULLS FIRST, last_evaluated_at NULLS FIRST
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  -- Reserve it immediately so a second scheduler tick cannot take the same
  -- property, and so a crash simply delays it by one interval.
  UPDATE public.revenue_pickup_automation_rules
     SET next_run_at = now() + make_interval(mins => GREATEST(60, v_row.evaluation_interval_minutes)),
         last_evaluated_at = now()
   WHERE id = v_row.id;

  RETURN QUERY SELECT v_row.hotel_id, v_row.id, v_row.evaluation_interval_minutes;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_automation_rule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_automation_rule() TO service_role;