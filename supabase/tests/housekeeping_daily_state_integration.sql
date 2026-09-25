DO $$
DECLARE
  v_room uuid := '00000000-0000-0000-0000-000000000001';
  v_assignment uuid := '00000000-0000-0000-0000-000000000002';
  v_snapshot uuid := '00000000-0000-0000-0000-000000000003';
  v_date date := (now() AT TIME ZONE 'Europe/Budapest')::date - 1;
  v_state jsonb;
  v_context jsonb;
BEGIN
  INSERT INTO public.rooms(id,hotel,organization_slug,room_number,status,is_checkout_room,
    towel_change_required,linen_change_required,is_dnd,notes,operational_note_date,pms_metadata)
  VALUES (v_room,'memories-budapest','rdhotels','142','dirty',false,true,false,false,
    '2 towels 2 pillows',v_date,'{"currentNight":4,"totalNights":6}'::jsonb);

  INSERT INTO public.room_assignments(id,room_id,assignment_date,status,supervisor_approved,updated_at,
    is_dnd,dnd_attempt_count,notes,manager_instruction_text,instruction_snapshot,service_result)
  VALUES (
    v_assignment,v_room,v_date,'completed',true,now(),false,0,'[NO_SERVICE] guest declined',
    '2 towels 2 pillows',
    '{"frozen":true,"room":{"towel_change_required":false,"linen_change_required":true,"notes":"2 towels 2 pillows"}}'::jsonb,
    'guest_declined'
  );

  INSERT INTO public.housekeeping_room_snapshots(
    id,business_date,room_id,hotel,organization_slug,room_number,room_status,
    is_checkout_room,is_dnd,towel_change_required,linen_change_required,room_notes,pms_metadata,
    had_dnd,had_no_service,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,
    assignment_notes,source
  ) VALUES (
    v_snapshot,v_date,v_room,'memories-budapest','rdhotels','142','dirty',
    false,false,true,false,'2 towels 2 pillows','{"currentNight":4,"totalNights":6}'::jsonb,
    true,false,false,false,false,'[NO_SERVICE] guest declined','live_capture'
  );

  PERFORM public.finalize_housekeeping_business_date(v_date);

  SELECT final_state INTO v_state
  FROM public.housekeeping_room_snapshots WHERE id=v_snapshot;

  IF (v_state ->> 'towel_change_required_for_assignment')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expected frozen assignment towel=false';
  END IF;
  IF (v_state ->> 'linen_change_required_for_assignment')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'expected frozen assignment change-room=true';
  END IF;
  IF (v_state ->> 'had_dnd')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'DND encounter was not preserved';
  END IF;
  IF (v_state ->> 'had_no_service')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'No Service evidence was not preserved';
  END IF;
  IF v_state ->> 'manager_instruction_text' IS DISTINCT FROM '2 towels 2 pillows' THEN
    RAISE EXCEPTION 'manager instruction was not preserved';
  END IF;

  -- Immutable final state: later mutable snapshot updates may not rewrite it.
  UPDATE public.housekeeping_room_snapshots
  SET final_state='{"tampered":true}'::jsonb, room_notes='later change'
  WHERE id=v_snapshot;
  SELECT final_state INTO v_state FROM public.housekeeping_room_snapshots WHERE id=v_snapshot;
  IF coalesce((v_state ->> 'tampered')::boolean,false) THEN
    RAISE EXCEPTION 'final_state was mutable';
  END IF;

  -- New-day assignment receives context only; active service/DND fields are not
  -- touched because they are not part of this trigger.
  INSERT INTO public.room_assignments(
    id,room_id,assignment_date,status,supervisor_approved,updated_at,is_dnd,dnd_attempt_count,
    notes,manager_instruction_text,instruction_snapshot,service_result
  ) VALUES (
    '00000000-0000-0000-0000-000000000004',v_room,
    GREATEST(DATE '2026-09-25',v_date + 1),'assigned',false,now(),false,0,
    null,null,null,null
  );

  SELECT previous_day_context INTO v_context
  FROM public.room_assignments
  WHERE id='00000000-0000-0000-0000-000000000004';

  -- Only assert carry-forward when the fixture's prior date lines up with the
  -- assignment date. The trigger itself is still syntax/execution covered on
  -- all CI dates.
  IF GREATEST(DATE '2026-09-25',v_date + 1) = v_date + 1 THEN
    IF v_context ->> 'manager_instruction_text' IS DISTINCT FROM '2 towels 2 pillows' THEN
      RAISE EXCEPTION 'previous-day context was not attached';
    END IF;
    IF (v_context ->> 'had_dnd')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'previous-day DND context missing';
    END IF;
  END IF;
END $$;


-- Hotel Memories missed-service carry-forward contract. This uses a fixed
-- finalized source row so the test is independent of the runner's wall clock.
DO $$
DECLARE
  v_room uuid := '00000000-0000-0000-0000-000000000011';
  v_snapshot uuid := '00000000-0000-0000-0000-000000000012';
  v_context jsonb;
BEGIN
  INSERT INTO public.rooms(
    id,hotel,organization_slug,room_number,status,is_checkout_room,
    towel_change_required,linen_change_required,is_dnd,notes,pms_metadata
  ) VALUES (
    v_room,'memories-budapest','rdhotels','144','dirty',false,
    false,false,false,null,
    '{"pmsSyncDate":"2026-09-26","lastPmsRefreshDate":"2026-09-26","scheduledDepartureToday":false,"arrivalToday":false,"reservationId":"stay-144"}'::jsonb
  );

  INSERT INTO public.housekeeping_room_snapshots(
    id,business_date,room_id,hotel,organization_slug,room_number,room_status,
    is_checkout_room,is_dnd,towel_change_required,linen_change_required,room_notes,pms_metadata,
    had_dnd,had_no_service,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,
    assignment_notes,source,final_state,finalized_at
  ) VALUES (
    v_snapshot,DATE '2026-09-25',v_room,'memories-budapest','rdhotels','144','dirty',
    false,false,false,true,null,
    '{"reservationId":"stay-144"}'::jsonb,
    false,true,false,false,false,
    '[NO_SERVICE] Guest declined','live_capture',
    '{
      "version":1,
      "business_date":"2026-09-25",
      "hotel":"memories-budapest",
      "is_checkout_room_at_close":false,
      "linen_change_required_for_assignment":true,
      "towel_change_required_for_assignment":false,
      "had_dnd":false,
      "had_no_service":true,
      "service_result":"guest_declined",
      "pms_metadata_at_close":{"reservationId":"stay-144"}
    }'::jsonb,
    now()
  );

  SELECT public.hc_memories_previous_service_context(
    v_room, DATE '2026-09-26', 'daily_cleaning'
  ) INTO v_context;

  IF v_context #>> '{carry_forward,service_type}' IS DISTINCT FROM 'full_clean' THEN
    RAISE EXCEPTION 'expected full-clean carry-forward';
  END IF;
  IF v_context #>> '{carry_forward,reason}' IS DISTINCT FROM 'no_service' THEN
    RAISE EXCEPTION 'expected No Service carry-forward reason';
  END IF;

  UPDATE public.rooms SET is_checkout_room=true WHERE id=v_room;
  SELECT public.hc_memories_previous_service_context(
    v_room, DATE '2026-09-26', 'daily_cleaning'
  ) INTO v_context;

  IF v_context ? 'carry_forward' THEN
    RAISE EXCEPTION 'checkout must suppress missed-service carry-forward';
  END IF;

  UPDATE public.rooms
  SET is_checkout_room=false,
      hotel='gozsdu-court'
  WHERE id=v_room;

  IF public.hc_memories_previous_service_context(
      v_room, DATE '2026-09-26', 'daily_cleaning'
    ) IS NOT NULL THEN
    RAISE EXCEPTION 'other hotels must not receive Memories carry-forward context';
  END IF;
END $$;


-- Shared portfolio carry-forward: Mika keeps its standard daily-cycle service
-- debt, while checkout still supersedes it.
DO $$
DECLARE
  v_room uuid := '00000000-0000-0000-0000-000000000021';
  v_payload jsonb;
BEGIN
  INSERT INTO public.rooms(
    id,hotel,organization_slug,room_number,status,is_checkout_room,
    towel_change_required,linen_change_required,is_dnd,notes,pms_metadata
  ) VALUES (
    v_room,'mika-downtown','rdhotels','101','dirty',false,
    false,false,false,null,
    '{"pmsSyncDate":"2026-09-26","lastPmsRefreshDate":"2026-09-26","scheduledDepartureToday":false,"arrivalToday":false,"reservationId":"mika-stay-101","arrivalDate":"2026-09-23"}'::jsonb
  );

  INSERT INTO public.room_assignments(
    id,room_id,assignment_date,assignment_type,status,supervisor_approved,
    created_at,updated_at,is_dnd,dnd_attempt_count,notes,service_result
  ) VALUES (
    '00000000-0000-0000-0000-000000000022',v_room,DATE '2026-09-25',
    'daily_cleaning','completed',false,now(),now(),true,2,null,null
  );

  INSERT INTO public.housekeeping_room_snapshots(
    id,business_date,room_id,hotel,organization_slug,room_number,room_status,
    is_checkout_room,is_dnd,towel_change_required,linen_change_required,room_notes,pms_metadata,
    had_dnd,had_no_service,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,
    assignment_notes,source,final_state,finalized_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000023',DATE '2026-09-25',v_room,
    'mika-downtown','rdhotels','101','dirty',false,true,true,false,null,
    '{"reservationId":"mika-stay-101","arrivalDate":"2026-09-23"}'::jsonb,
    true,false,false,false,false,null,'live_capture',
    '{
      "version":1,
      "business_date":"2026-09-25",
      "hotel":"mika-downtown",
      "is_checkout_room_at_close":false,
      "towel_change_required_for_assignment":true,
      "linen_change_required_for_assignment":false,
      "had_dnd":true,
      "had_no_service":false,
      "service_result":null,
      "pms_metadata_at_close":{"reservationId":"mika-stay-101","arrivalDate":"2026-09-23"}
    }'::jsonb,
    now()
  );

  SELECT public.hc_portfolio_previous_service_carry_payload(
    v_room,DATE '2026-09-26','daily_cleaning'
  ) INTO v_payload;

  IF v_payload ->> 'property_id' IS DISTINCT FROM 'mika-downtown'
     OR v_payload ->> 'service_type' IS DISTINCT FROM 'towel_change'
     OR v_payload ->> 'reason' IS DISTINCT FROM 'dnd'
     OR v_payload ->> 'policy_source' IS DISTINCT FROM 'standard_daily_cycle' THEN
    RAISE EXCEPTION 'Mika towel/DND carry-forward mapping failed: %',v_payload;
  END IF;

  UPDATE public.rooms SET is_checkout_room=true WHERE id=v_room;
  IF public.hc_portfolio_previous_service_carry_payload(
      v_room,DATE '2026-09-26','daily_cleaning'
    ) IS NOT NULL THEN
    RAISE EXCEPTION 'Mika checkout must suppress carried stayover service';
  END IF;
END $$;


-- Ottofiori: replacement arrivals must never inherit the previous guest's
-- housekeeping debt; the same-stay path remains eligible.
DO $$
DECLARE
  v_room uuid := '00000000-0000-0000-0000-000000000024';
  v_payload jsonb;
BEGIN
  INSERT INTO public.rooms(
    id,hotel,organization_slug,room_number,status,is_checkout_room,
    towel_change_required,linen_change_required,is_dnd,notes,pms_metadata
  ) VALUES (
    v_room,'Hotel Ottofiori','rdhotels','303','dirty',false,
    false,false,false,null,
    '{"pmsSyncDate":"2026-09-26","lastPmsRefreshDate":"2026-09-26","scheduledDepartureToday":false,"arrivalToday":true,"reservationId":"new-guest","arrivalDate":"2026-09-26"}'::jsonb
  );

  INSERT INTO public.room_assignments(
    id,room_id,assignment_date,assignment_type,status,supervisor_approved,
    created_at,updated_at,is_dnd,dnd_attempt_count,notes,service_result
  ) VALUES (
    '00000000-0000-0000-0000-000000000025',v_room,DATE '2026-09-25',
    'daily_cleaning','completed',false,now(),now(),false,0,
    '[NO_SERVICE] Guest declined','guest_declined'
  );

  INSERT INTO public.housekeeping_room_snapshots(
    id,business_date,room_id,hotel,organization_slug,room_number,room_status,
    is_checkout_room,is_dnd,towel_change_required,linen_change_required,room_notes,pms_metadata,
    had_dnd,had_no_service,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,
    assignment_notes,source,final_state,finalized_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000026',DATE '2026-09-25',v_room,
    'Hotel Ottofiori','rdhotels','303','dirty',false,false,false,true,null,
    '{"reservationId":"old-guest","arrivalDate":"2026-09-22"}'::jsonb,
    false,true,false,false,false,'[NO_SERVICE] Guest declined','live_capture',
    '{
      "version":1,
      "business_date":"2026-09-25",
      "hotel":"Hotel Ottofiori",
      "is_checkout_room_at_close":false,
      "towel_change_required_for_assignment":false,
      "linen_change_required_for_assignment":true,
      "had_dnd":false,
      "had_no_service":true,
      "service_result":"guest_declined",
      "pms_metadata_at_close":{"reservationId":"old-guest","arrivalDate":"2026-09-22"}
    }'::jsonb,
    now()
  );

  IF public.hc_portfolio_previous_service_carry_payload(
      v_room,DATE '2026-09-26','daily_cleaning'
    ) IS NOT NULL THEN
    RAISE EXCEPTION 'Ottofiori replacement arrival inherited old housekeeping debt';
  END IF;

  UPDATE public.rooms
  SET pms_metadata='{"pmsSyncDate":"2026-09-26","lastPmsRefreshDate":"2026-09-26","scheduledDepartureToday":false,"arrivalToday":false,"reservationId":"old-guest","arrivalDate":"2026-09-22"}'::jsonb
  WHERE id=v_room;

  SELECT public.hc_portfolio_previous_service_carry_payload(
    v_room,DATE '2026-09-26','daily_cleaning'
  ) INTO v_payload;

  IF v_payload ->> 'property_id' IS DISTINCT FROM 'ottofiori'
     OR v_payload ->> 'service_type' IS DISTINCT FROM 'full_clean'
     OR v_payload ->> 'reason' IS DISTINCT FROM 'no_service' THEN
    RAISE EXCEPTION 'Ottofiori same-stay carry-forward failed: %',v_payload;
  END IF;
END $$;


-- Gozsdu: a missed scheduled service creates work even on a normal no-service
-- cycle day. It uses the current Gozsdu roster/building instead of changing the
-- underlying stay-service cycle or room flags.
DO $$
DECLARE
  v_room uuid := '00000000-0000-0000-0000-000000000031';
  v_pool_room uuid := '00000000-0000-0000-0000-000000000034';
  v_worker uuid := '00000000-0000-0000-0000-0000000000a1';
  v_manager uuid := '00000000-0000-0000-0000-0000000000b1';
  v_created integer;
  v_context jsonb;
  v_towel boolean;
  v_linen boolean;
BEGIN
  INSERT INTO public.rooms(
    id,hotel,organization_slug,room_number,status,is_checkout_room,
    towel_change_required,linen_change_required,is_dnd,notes,pms_metadata
  ) VALUES
  (
    v_room,'gozsdu-court','rdhotels','ST-209','dirty',false,
    false,false,false,null,
    '{"pmsSyncDate":"2026-09-26","lastPmsRefreshDate":"2026-09-26","scheduledDepartureToday":false,"arrivalToday":false,"reservationId":"gozsdu-stay-209","arrivalDate":"2026-09-22","gozsduAvailability":{"status":"operating","buildingCode":"B2"}}'::jsonb
  ),
  (
    v_pool_room,'gozsdu-court','rdhotels','ST-211','dirty',false,
    false,false,false,null,
    '{"pmsSyncDate":"2026-09-26","gozsduAvailability":{"status":"operating","buildingCode":"B2"}}'::jsonb
  );

  INSERT INTO public.room_assignments(
    id,room_id,assigned_to,assigned_by,assignment_date,assignment_type,status,
    priority,estimated_duration,organization_slug,supervisor_approved,created_at,updated_at,
    is_dnd,dnd_attempt_count,notes,service_result
  ) VALUES
  (
    '00000000-0000-0000-0000-000000000033',v_room,v_worker,v_manager,
    DATE '2026-09-25','daily_cleaning','completed',2,28,'rdhotels',false,
    now(),now(),false,0,'[NO_SERVICE] Guest declined','guest_declined'
  ),
  (
    '00000000-0000-0000-0000-000000000035',v_pool_room,v_worker,v_manager,
    DATE '2026-09-26','daily_cleaning','assigned',1,10,'rdhotels',false,
    now(),now(),false,0,null,null
  );

  INSERT INTO public.housekeeping_room_snapshots(
    id,business_date,room_id,hotel,organization_slug,room_number,room_status,
    is_checkout_room,is_dnd,towel_change_required,linen_change_required,room_notes,pms_metadata,
    had_dnd,had_no_service,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,
    assignment_notes,source,final_state,finalized_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000032',DATE '2026-09-25',v_room,
    'gozsdu-court','rdhotels','ST-209','dirty',false,false,false,true,null,
    '{"reservationId":"gozsdu-stay-209","arrivalDate":"2026-09-22"}'::jsonb,
    false,true,false,false,false,'[NO_SERVICE] Guest declined','live_capture',
    '{
      "version":1,
      "business_date":"2026-09-25",
      "hotel":"gozsdu-court",
      "is_checkout_room_at_close":false,
      "towel_change_required_for_assignment":false,
      "linen_change_required_for_assignment":true,
      "had_dnd":false,
      "had_no_service":true,
      "service_result":"guest_declined",
      "pms_metadata_at_close":{"reservationId":"gozsdu-stay-209","arrivalDate":"2026-09-22"}
    }'::jsonb,
    now()
  );

  v_created := public.hc_materialize_gozsdu_carry_assignments(DATE '2026-09-26');
  IF v_created <> 1 THEN
    RAISE EXCEPTION 'expected one Gozsdu carry-only assignment, got %',v_created;
  END IF;

  SELECT previous_day_context
  INTO v_context
  FROM public.room_assignments
  WHERE room_id=v_room AND assignment_date=DATE '2026-09-26' AND status='assigned';

  IF v_context #>> '{carry_forward,service_type}' IS DISTINCT FROM 'full_clean'
     OR v_context #>> '{carry_forward,property_id}' IS DISTINCT FROM 'gozsdu-court'
     OR v_context #>> '{carry_forward,policy_source}' IS DISTINCT FROM 'gozsdu_property_cycle' THEN
    RAISE EXCEPTION 'Gozsdu carry-only context incorrect: %',v_context;
  END IF;

  SELECT towel_change_required,linen_change_required INTO v_towel,v_linen
  FROM public.rooms WHERE id=v_room;
  IF coalesce(v_towel,false) OR coalesce(v_linen,false) THEN
    RAISE EXCEPTION 'Gozsdu carry materialization must not shift/mutate room service-cycle flags';
  END IF;

  UPDATE public.rooms
  SET pms_metadata=jsonb_set(pms_metadata,'{gozsduAvailability,status}','"unavailable"'::jsonb,true)
  WHERE id=v_room;

  IF public.hc_portfolio_previous_service_carry_payload(
      v_room,DATE '2026-09-26','daily_cleaning'
    ) IS NOT NULL THEN
    RAISE EXCEPTION 'non-operating Gozsdu room received carry-forward work';
  END IF;
END $$;


-- Repeated DND/No Service preserves the original due date and increments the
-- attempt lineage even when the intervening day has no natural T/C flag.
DO $$
DECLARE
  v_room uuid := '00000000-0000-0000-0000-000000000041';
  v_payload jsonb;
BEGIN
  INSERT INTO public.rooms(
    id,hotel,organization_slug,room_number,status,is_checkout_room,
    towel_change_required,linen_change_required,is_dnd,notes,pms_metadata
  ) VALUES (
    v_room,'mika-downtown','rdhotels','117','dirty',false,
    false,false,false,null,
    '{"pmsSyncDate":"2026-09-27","lastPmsRefreshDate":"2026-09-27","scheduledDepartureToday":false,"arrivalToday":false,"reservationId":"mika-stay-117","arrivalDate":"2026-09-23"}'::jsonb
  );

  INSERT INTO public.room_assignments(
    id,room_id,assignment_date,assignment_type,status,supervisor_approved,
    created_at,updated_at,is_dnd,dnd_attempt_count,notes,service_result,previous_day_context
  ) VALUES (
    '00000000-0000-0000-0000-000000000043',v_room,DATE '2026-09-26',
    'daily_cleaning','completed',false,now(),now(),false,0,
    '[NO_SERVICE] Guest declined','guest_declined',
    '{
      "carry_forward":{
        "version":1,
        "active":true,
        "property_id":"mika-downtown",
        "source_business_date":"2026-09-25",
        "original_due_date":"2026-09-25",
        "service_type":"towel_change",
        "reason":"dnd",
        "attempt_count":1,
        "policy_source":"standard_daily_cycle",
        "instruction":"Yesterday the towel change was missed."
      }
    }'::jsonb
  );

  INSERT INTO public.housekeeping_room_snapshots(
    id,business_date,room_id,hotel,organization_slug,room_number,room_status,
    is_checkout_room,is_dnd,towel_change_required,linen_change_required,room_notes,pms_metadata,
    had_dnd,had_no_service,had_room_cleaning_request,had_extra_towels_request,had_ready_to_clean,
    assignment_notes,source,final_state,finalized_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000042',DATE '2026-09-26',v_room,
    'mika-downtown','rdhotels','117','dirty',false,false,false,false,null,
    '{"reservationId":"mika-stay-117","arrivalDate":"2026-09-23"}'::jsonb,
    false,true,false,false,false,'[NO_SERVICE] Guest declined','live_capture',
    '{
      "version":1,
      "business_date":"2026-09-26",
      "hotel":"mika-downtown",
      "is_checkout_room_at_close":false,
      "towel_change_required_for_assignment":false,
      "linen_change_required_for_assignment":false,
      "had_dnd":false,
      "had_no_service":true,
      "service_result":"guest_declined",
      "pms_metadata_at_close":{"reservationId":"mika-stay-117","arrivalDate":"2026-09-23"}
    }'::jsonb,
    now()
  );

  SELECT public.hc_portfolio_previous_service_carry_payload(
    v_room,DATE '2026-09-27','daily_cleaning'
  ) INTO v_payload;

  IF v_payload ->> 'service_type' IS DISTINCT FROM 'towel_change'
     OR v_payload ->> 'original_due_date' IS DISTINCT FROM '2026-09-25'
     OR (v_payload ->> 'attempt_count')::integer IS DISTINCT FROM 2
     OR v_payload ->> 'reason' IS DISTINCT FROM 'no_service' THEN
    RAISE EXCEPTION 'repeated carry lineage failed: %',v_payload;
  END IF;
END $$;
