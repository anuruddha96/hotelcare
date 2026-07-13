CREATE OR REPLACE FUNCTION public.enqueue_pms_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg record;
  v_room record;
  v_target text;
BEGIN
  -- Fire only on the false->true transition of supervisor_approved.
  IF NEW.supervisor_approved IS NOT TRUE
     OR OLD.supervisor_approved IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Previo room id is stored in pms_metadata->>'roomId' (there is no
  -- rooms.previo_room_id column).
  SELECT r.id,
         NULLIF(r.pms_metadata->>'roomId', '') AS previo_room_id,
         r.hotel
    INTO v_room
    FROM public.rooms r
   WHERE r.id = NEW.room_id;

  IF v_room.id IS NULL OR v_room.previo_room_id IS NULL THEN
    RETURN NEW; -- room not mapped to Previo yet
  END IF;

  SELECT status_push_enabled, outbound_kill_switch, outbound_room_allowlist
    INTO v_cfg
    FROM public.pms_configurations
   WHERE hotel_id = v_room.hotel
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
    v_room.hotel, v_room.id, v_room.previo_room_id, v_target,
    NEW.id,
    jsonb_build_object(
      'trigger', 'supervisor_approved',
      'assignment_date', NEW.assignment_date
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