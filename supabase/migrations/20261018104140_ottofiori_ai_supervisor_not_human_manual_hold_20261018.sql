-- Mirrors Supabase production migration 20261018104140, already applied 2026-10-18.
-- Keep genuine human manager overrides protected for 24h while excluding
-- AI supervisor decisions tagged ai_* even when legacy intent_source='manual'.
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

  -- Manual pushes always carry intent_source='manual'. Reading that directly
  -- avoids a join/scan across Ottofiori's very large historical draft table
  -- for every row in an automatic pricing batch.
  SELECT d.created_at
    INTO v_manual_at
    FROM public.revenue_rate_drafts d
   WHERE d.hotel_id = new.hotel_id
     AND d.stay_date = new.stay_date
     AND d.intent_source = 'manual'
       -- AI-authored pricing decisions are not human manager overrides.
       AND coalesce(d.decision_reason, '') !~ '^ai_'
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
       -- AI-authored pricing decisions are not human manager overrides.
       AND coalesce(d.decision_reason, '') !~ '^ai_'
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
$function$

