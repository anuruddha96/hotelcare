-- Prevent Revenue Engine queue inserts from timing out under Ottofiori's large
-- historical draft volume. Keep browser/user timeouts unchanged; this only
-- gives backend service-role work enough headroom during transient I/O spikes.

CREATE INDEX IF NOT EXISTS idx_rrd_manual_guard
ON public.revenue_rate_drafts (hotel_id, stay_date, created_at DESC)
INCLUDE (obk_id, room_type_name, occupancy, new_price, status)
WHERE intent_source = 'manual' AND status NOT IN ('failed','superseded');

CREATE INDEX IF NOT EXISTS idx_rdd_daily_markdown_budget
ON public.revenue_date_decisions (hotel_id, stay_date, created_at DESC)
INCLUDE (movement, status)
WHERE direction = 'decrease';

CREATE INDEX IF NOT EXISTS idx_rpar_hotel_enabled_updated
ON public.revenue_pickup_automation_rules (hotel_id, is_enabled, updated_at DESC);

CREATE OR REPLACE FUNCTION public.guard_ottofiori_manual_price_hold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_source text;
  v_manual_at timestamptz;
  v_manual_cell_target numeric;
BEGIN
  IF new.hotel_id <> 'ottofiori' OR new.push_run_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT r.source
    INTO v_run_source
    FROM public.revenue_rate_push_runs r
   WHERE r.id = new.push_run_id;

  IF coalesce(v_run_source, '') = 'manual' THEN
    RETURN new;
  END IF;

  -- Manual pushes are explicitly tagged intent_source='manual'. Reading that
  -- directly is indexable and avoids repeatedly joining/scanning the very large
  -- historical draft table for every row of an automatic pricing batch.
  SELECT d.created_at
    INTO v_manual_at
    FROM public.revenue_rate_drafts d
   WHERE d.hotel_id = new.hotel_id
     AND d.stay_date = new.stay_date
     AND d.intent_source = 'manual'
     AND d.created_at >= now() - interval '24 hours'
     AND d.status NOT IN ('failed', 'superseded')
   ORDER BY d.created_at DESC
   LIMIT 1;

  IF v_manual_at IS NULL THEN
    RETURN new;
  END IF;

  IF coalesce(v_run_source, '') = 'reconcile' THEN
    SELECT d.new_price
      INTO v_manual_cell_target
      FROM public.revenue_rate_drafts d
     WHERE d.hotel_id = new.hotel_id
       AND d.stay_date = new.stay_date
       AND d.intent_source = 'manual'
       AND coalesce(d.obk_id, '') = coalesce(new.obk_id, '')
       AND d.room_type_name = new.room_type_name
       AND d.occupancy = new.occupancy
       AND d.created_at >= now() - interval '24 hours'
       AND d.status NOT IN ('failed', 'superseded')
     ORDER BY d.created_at DESC
     LIMIT 1;

    IF v_manual_cell_target IS NOT NULL
       AND abs(v_manual_cell_target - new.new_price) <= 0.01 THEN
      RETURN new;
    END IF;
  END IF;

  new.status := 'superseded';
  new.confirmation_status := 'superseded';
  new.superseded_at := now();
  new.reconcile_state := 'manual_hold_blocked';
  new.reconcile_next_at := null;
  new.push_error := 'Manager price protected for 24h: automatic/reconcile overwrite blocked.';

  RETURN new;
END;
$function$;

ALTER ROLE service_role SET statement_timeout = '45s';

ANALYZE public.revenue_rate_drafts;
ANALYZE public.revenue_date_decisions;
ANALYZE public.revenue_pickup_automation_rules;
