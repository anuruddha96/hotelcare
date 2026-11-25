-- A No Service / guest-declined / towel-only completion is a handled outcome,
-- not a cleaned room. Keep HotelCare, the outbound queue and Previo consistent.
-- A supervisor can still explicitly override the outcome later via the room
-- operations "Mark Clean & Sync PMS" action, which converts service_result to
-- cleaned before changing the room status.

CREATE OR REPLACE FUNCTION public.update_room_status_on_assignment_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- When assignment is marked as completed, set completed_at timestamp but don't update room status.
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = now();
  END IF;

  -- Only a genuine cleaned outcome may turn the room clean on approval.
  -- No Service, DND and towel-only outcomes remain handled-but-not-cleaned.
  IF NEW.supervisor_approved = true
     AND OLD.supervisor_approved = false
     AND COALESCE(NEW.is_dnd, false) = false
     AND COALESCE(NEW.service_result, '') <> 'guest_declined'
     AND COALESCE(NEW.notes, '') NOT LIKE '%[NO_SERVICE]%'
     AND COALESCE(NEW.notes, '') NOT LIKE '%[TOWEL_CHANGE_ONLY]%' THEN
    UPDATE public.rooms
    SET
      status = 'clean',
      last_cleaned_at = now(),
      last_cleaned_by = NEW.assigned_to,
      updated_at = now()
    WHERE id = NEW.room_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_pms_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg record;
  v_room record;
  v_hotel_id text;
  v_target text;
  v_acct record;
  v_map record;
BEGIN
  IF NEW.supervisor_approved IS NOT TRUE
     OR OLD.supervisor_approved IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Approval is not equivalent to cleaning for No Service / DND / towel-only.
  -- Do not enqueue a fake clean push; the explicit supervisor clean override
  -- converts these fields before requesting a clean status.
  IF COALESCE(NEW.is_dnd, false) = true
     OR NEW.service_result = 'guest_declined'
     OR COALESCE(NEW.notes, '') LIKE '%[NO_SERVICE]%'
     OR COALESCE(NEW.notes, '') LIKE '%[TOWEL_CHANGE_ONLY]%' THEN
    RETURN NEW;
  END IF;

  SELECT r.id,
         NULLIF(r.pms_metadata->>'roomId', '') AS previo_room_id,
         r.hotel
    INTO v_room
    FROM public.rooms r
   WHERE r.id = NEW.room_id;

  IF v_room.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(h.hotel_id, v_room.hotel)
    INTO v_hotel_id
    FROM (SELECT v_room.hotel AS raw_hotel) x
    LEFT JOIN public.hotel_configurations h
      ON h.hotel_id = x.raw_hotel OR h.hotel_name = x.raw_hotel
   LIMIT 1;

  v_target := 'clean';

  -- Legacy single-configuration tenants.
  SELECT status_push_enabled, outbound_kill_switch, outbound_room_allowlist
    INTO v_cfg
    FROM public.pms_configurations
   WHERE hotel_id = v_hotel_id
     AND pms_type = 'previo'
   LIMIT 1;

  IF v_cfg IS NOT NULL THEN
    IF v_room.previo_room_id IS NULL
       OR COALESCE(v_cfg.status_push_enabled, false) = false
       OR COALESCE(v_cfg.outbound_kill_switch, true) = true THEN
      RETURN NEW;
    END IF;

    IF v_cfg.outbound_room_allowlist IS NULL
       OR array_length(v_cfg.outbound_room_allowlist, 1) IS NULL
       OR NOT (v_room.id = ANY (v_cfg.outbound_room_allowlist)) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.pms_outbound_queue (
      hotel_id, room_id, previo_room_id, target_status,
      source_assignment_id, payload
    ) VALUES (
      v_hotel_id, v_room.id, v_room.previo_room_id, v_target,
      NEW.id,
      jsonb_build_object(
        'trigger', 'supervisor_approved',
        'assignment_date', NEW.assignment_date,
        'room_hotel_label', v_room.hotel
      )
    );
    RETURN NEW;
  END IF;

  -- Portfolio tenants: resolve the owning PMS account through unit mapping.
  SELECT m.pms_account_id, m.external_room_id
    INTO v_map
    FROM public.pms_unit_mappings m
   WHERE m.room_id = v_room.id
     AND m.external_room_id IS NOT NULL
   ORDER BY (m.status = 'confirmed') DESC, m.updated_at DESC
   LIMIT 1;

  IF v_map.pms_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, status_push_enabled, outbound_kill_switch, is_active
    INTO v_acct
    FROM public.pms_accounts
   WHERE id = v_map.pms_account_id
   LIMIT 1;

  IF v_acct.id IS NULL
     OR COALESCE(v_acct.is_active, false) = false
     OR COALESCE(v_acct.status_push_enabled, false) = false
     OR COALESCE(v_acct.outbound_kill_switch, true) = true THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pms_outbound_queue (
    hotel_id, room_id, previo_room_id, target_status,
    source_assignment_id, payload
  ) VALUES (
    v_hotel_id, v_room.id, COALESCE(v_room.previo_room_id, v_map.external_room_id), v_target,
    NEW.id,
    jsonb_build_object(
      'trigger', 'supervisor_approved',
      'assignment_date', NEW.assignment_date,
      'room_hotel_label', v_room.hotel,
      'pms_account_id', v_acct.id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'enqueue_pms_outbound failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_previo_clean_status_from_metadata_refresh()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Hotel Memories Budapest: preserve a clean room against a later PMS
  -- reconciliation only when today's approved outcome was an actual cleaning.
  -- A No Service / DND / towel-only approval must not freeze a false clean state.
  IF OLD.status = 'clean'
     AND NEW.status = 'dirty'
     AND OLD.hotel IN ('Hotel Memories Budapest', 'memories-budapest')
     AND (
       NEW.pms_metadata IS DISTINCT FROM OLD.pms_metadata
       OR NEW.checkout_time IS DISTINCT FROM OLD.checkout_time
       OR NEW.is_checkout_room IS DISTINCT FROM OLD.is_checkout_room
     )
     AND EXISTS (
       SELECT 1
       FROM public.room_assignments ra
       WHERE ra.room_id = OLD.id
         AND ra.assignment_date = timezone('Europe/Budapest', now())::date
         AND ra.status::text = 'completed'
         AND ra.supervisor_approved IS true
         AND COALESCE(ra.is_dnd, false) = false
         AND COALESCE(ra.service_result, '') <> 'guest_declined'
         AND COALESCE(ra.notes, '') NOT LIKE '%[NO_SERVICE]%'
         AND COALESCE(ra.notes, '') NOT LIKE '%[TOWEL_CHANGE_ONLY]%'
     ) THEN
    NEW.status := OLD.status;
  END IF;

  -- Existing generic protection for metadata refreshes when Previo itself was
  -- already verified clean/inspected.
  IF OLD.status = 'clean'
     AND NEW.status = 'dirty'
     AND COALESCE(OLD.pms_metadata->>'previoRoomCleanStatusId', '') IN ('2', '3')
     AND NEW.pms_metadata IS DISTINCT FROM OLD.pms_metadata
     AND (NEW.pms_metadata ? 'pmsSyncDate' OR NEW.pms_metadata ? 'lastPmsRefreshDate') THEN
    NEW.status := OLD.status;
  END IF;

  RETURN NEW;
END;
$function$;
