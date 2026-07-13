CREATE OR REPLACE FUNCTION public.enqueue_pms_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cfg record;
  v_room record;
  v_hotel_id text;
  v_target text;
BEGIN
  -- Fire only on the false->true transition of supervisor_approved.
  IF NEW.supervisor_approved IS NOT TRUE
     OR OLD.supervisor_approved IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Previo room id is stored in pms_metadata->>'roomId'.
  SELECT r.id,
         NULLIF(r.pms_metadata->>'roomId', '') AS previo_room_id,
         r.hotel
    INTO v_room
    FROM public.rooms r
   WHERE r.id = NEW.room_id;

  IF v_room.id IS NULL OR v_room.previo_room_id IS NULL THEN
    RETURN NEW; -- room not mapped to Previo yet
  END IF;

  -- Rooms may store either hotel_id (ottofiori) or hotel_name (Hotel Ottofiori).
  SELECT COALESCE(h.hotel_id, v_room.hotel)
    INTO v_hotel_id
    FROM (SELECT v_room.hotel AS raw_hotel) x
    LEFT JOIN public.hotel_configurations h
      ON h.hotel_id = x.raw_hotel OR h.hotel_name = x.raw_hotel
   LIMIT 1;

  SELECT status_push_enabled, outbound_kill_switch, outbound_room_allowlist
    INTO v_cfg
    FROM public.pms_configurations
   WHERE hotel_id = v_hotel_id
     AND pms_type = 'previo'
   LIMIT 1;

  IF v_cfg IS NULL
     OR COALESCE(v_cfg.status_push_enabled, false) = false
     OR COALESCE(v_cfg.outbound_kill_switch, true) = true THEN
    RETURN NEW; -- outbound disabled for this hotel
  END IF;

  -- Allowlist is uuid[]; must be non-empty AND contain this room id.
  IF v_cfg.outbound_room_allowlist IS NULL
     OR array_length(v_cfg.outbound_room_allowlist, 1) IS NULL
     OR NOT (v_room.id = ANY (v_cfg.outbound_room_allowlist)) THEN
    RETURN NEW;
  END IF;

  v_target := 'clean';

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
EXCEPTION WHEN OTHERS THEN
  -- Never block the approval; log and continue.
  RAISE WARNING 'enqueue_pms_outbound failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_pms_outbound() FROM PUBLIC;