-- Align manager authority at both planner and publisher, and scope internal function privileges.
CREATE OR REPLACE FUNCTION public.guard_ottofiori_manual_price_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run_source text;
  v_manual_at timestamptz;
  v_hold_hours numeric := 4;
  v_hard_locked boolean := false;
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

  SELECT coalesce(r.manual_hold_hours,4) INTO v_hold_hours
  FROM public.revenue_pickup_automation_rules r
  WHERE r.hotel_id=new.hotel_id AND r.organization_slug='rdhotels' LIMIT 1;
  v_hold_hours:=greatest(0,coalesce(v_hold_hours,4));
  SELECT EXISTS(SELECT 1 FROM public.revenue_manual_locks l
    WHERE l.hotel_id=new.hotel_id AND l.stay_date=new.stay_date AND l.locked_until>now())
    INTO v_hard_locked;

  -- Only verified pickup may lift a soft manual price hold. Hard locks win.
  IF NOT v_hard_locked AND new.decision_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.revenue_date_decisions d
    WHERE d.id=new.decision_id AND d.hotel_id=new.hotel_id AND d.stay_date=new.stay_date
      AND d.status='queued' AND d.direction='increase' AND d.movement>0
      AND greatest(0,coalesce(d.pickup_24h,0)-coalesce(d.cancellations_24h,0))>0
  ) THEN RETURN new; END IF;

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
     AND d.created_at >= now() - make_interval(secs=>(v_hold_hours*3600)::double precision)
     AND d.status NOT IN ('failed', 'superseded')
   ORDER BY d.created_at DESC
   LIMIT 1;

  IF v_manual_at IS NULL AND NOT v_hard_locked THEN
    RETURN new;
  END IF;

  IF NOT v_hard_locked AND coalesce(v_run_source, '') = 'reconcile' THEN
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
       AND d.created_at >= now() - make_interval(secs=>(v_hold_hours*3600)::double precision)
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
  new.push_error := CASE WHEN v_hard_locked THEN 'Manager hard lock: automatic overwrite blocked.' ELSE format('Manager price protected for %sh: automatic/reconcile overwrite blocked.',v_hold_hours) END;

  RETURN new;
END;
$function$;

-- Internal scheduler and trigger functions are not client RPCs.
REVOKE ALL ON FUNCTION public.enforce_ottofiori_push_direction_integrity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_ottofiori_push_direction_integrity() TO service_role;
REVOKE ALL ON FUNCTION public.guard_ottofiori_manual_price_hold() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_ottofiori_manual_price_hold() TO service_role;
REVOKE ALL ON FUNCTION public.claim_due_automation_rule() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_automation_rule() TO service_role;
