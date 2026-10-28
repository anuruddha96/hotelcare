-- Hotel Memories Budapest: prevent yesterday's service flags entering today's room board.
DO $migration$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.hc_apply_memories_service_cycle()'::regprocedure) INTO v_def;
  IF position($marker$  v_arrival_night integer;$marker$ in v_def) = 0 THEN
    IF position($old$  v_previous_computed boolean;
BEGIN$old$ in v_def) = 0 THEN RAISE EXCEPTION 'Missing expected hc_apply_memories_service_cycle anchor'; END IF;
    v_def := replace(v_def, $old$  v_previous_computed boolean;
BEGIN$old$, $new$  v_previous_computed boolean;
  v_arrival_night integer;
BEGIN$new$);
    IF position($old$  IF v_night < 1 OR v_total < 1 OR v_night > v_total OR v_total > 90 THEN RETURN NEW; END IF;$old$ in v_def) = 0 THEN RAISE EXCEPTION 'Missing expected hc_apply_memories_service_cycle anchor'; END IF;
    v_def := replace(v_def, $old$  IF v_night < 1 OR v_total < 1 OR v_night > v_total OR v_total > 90 THEN RETURN NEW; END IF;$old$, $new$  IF v_night < 1 OR v_total < 1 OR v_night > v_total OR v_total > 90 THEN RETURN NEW; END IF;
  -- PMS sometimes advances the sync date before the guest-night counter.
  IF coalesce(v_meta ->> 'arrivalDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    BEGIN
      v_arrival_night := v_today::date - (v_meta ->> 'arrivalDate')::date + 1;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      v_arrival_night := NULL;
    END;
  END IF;$new$);
    IF position($old$     AND coalesce(v_meta ->> 'occupiedToday','false') = 'true'
  THEN$old$ in v_def) = 0 THEN RAISE EXCEPTION 'Missing expected hc_apply_memories_service_cycle anchor'; END IF;
    v_def := replace(v_def, $old$     AND coalesce(v_meta ->> 'occupiedToday','false') = 'true'
  THEN$old$, $new$     AND coalesce(v_meta ->> 'occupiedToday','false') = 'true'
     AND v_arrival_night = v_night
     AND coalesce(v_meta ->> 'departureDate','') > v_today
  THEN$new$);
    EXECUTE v_def;
  END IF;
  SELECT pg_get_functiondef('public.hc_memories_preserve_same_day_verified_service()'::regprocedure) INTO v_def;
  IF position($marker$  v_arrival_night integer;$marker$ in v_def) = 0 THEN
    IF position($old$  v_due jsonb;
BEGIN$old$ in v_def) = 0 THEN RAISE EXCEPTION 'Missing expected hc_memories_preserve_same_day_verified_service anchor'; END IF;
    v_def := replace(v_def, $old$  v_due jsonb;
BEGIN$old$, $new$  v_due jsonb;
  v_arrival_night integer;
BEGIN$new$);
    IF position($old$  SELECT s.scheduled_service_due INTO v_due$old$ in v_def) = 0 THEN RAISE EXCEPTION 'Missing expected hc_memories_preserve_same_day_verified_service anchor'; END IF;
    v_def := replace(v_def, $old$  SELECT s.scheduled_service_due INTO v_due$old$, $new$  -- Reject provisional prior-night evidence even if written to today's snapshot.
  IF coalesce(NEW.pms_metadata ->> 'arrivalDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR coalesce(NEW.pms_metadata ->> 'currentNight','') !~ '^[0-9]{1,2}$'
  THEN RETURN NEW; END IF;
  BEGIN
    v_arrival_night := v_today::date - (NEW.pms_metadata ->> 'arrivalDate')::date + 1;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NEW;
  END;
  IF v_arrival_night <> (NEW.pms_metadata ->> 'currentNight')::integer
     OR coalesce(NEW.pms_metadata ->> 'departureDate','') <= v_today
  THEN RETURN NEW; END IF;
  SELECT s.scheduled_service_due INTO v_due$new$);
    IF position($old$  IF v_due IS NULL
    OR nullif(v_due->>'reservation_id','') IS NULL$old$ in v_def) = 0 THEN RAISE EXCEPTION 'Missing expected hc_memories_preserve_same_day_verified_service anchor'; END IF;
    v_def := replace(v_def, $old$  IF v_due IS NULL
    OR nullif(v_due->>'reservation_id','') IS NULL$old$, $new$  IF v_due IS NULL
    OR v_due->>'business_date' IS DISTINCT FROM v_today
    OR v_due->>'stay_night' IS DISTINCT FROM NEW.pms_metadata->>'currentNight'
    OR nullif(v_due->>'reservation_id','') IS NULL$new$);
    EXECUTE v_def;
  END IF;
  SELECT pg_get_functiondef('public.hc_capture_memories_scheduled_service_due()'::regprocedure) INTO v_def;
  IF position($marker$  -- Reject provisional prior-night flags during morning PMS rollover.$marker$ in v_def) = 0 THEN
    IF position($old$  -- 'Ever due' is a planned-duty audit, NOT a completed towel/linen service.$old$ in v_def) = 0 THEN RAISE EXCEPTION 'Missing expected hc_capture_memories_scheduled_service_due anchor'; END IF;
    v_def := replace(v_def, $old$  -- 'Ever due' is a planned-duty audit, NOT a completed towel/linen service.$old$, $new$  -- Reject provisional prior-night flags during morning PMS rollover.
  IF coalesce(NEW.pms_metadata ->> 'arrivalDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR coalesce(NEW.pms_metadata ->> 'currentNight','') !~ '^[0-9]{1,2}$'
  THEN RETURN NEW; END IF;
  BEGIN
    IF (v_day - (NEW.pms_metadata ->> 'arrivalDate')::date + 1)
          <> (NEW.pms_metadata ->> 'currentNight')::integer
       OR coalesce(NEW.pms_metadata ->> 'departureDate','') <= v_day::text
    THEN RETURN NEW; END IF;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN NEW;
  END;
  -- 'Ever due' is a planned-duty audit, NOT a completed towel/linen service.$new$);
    EXECUTE v_def;
  END IF;
END;
$migration$;
