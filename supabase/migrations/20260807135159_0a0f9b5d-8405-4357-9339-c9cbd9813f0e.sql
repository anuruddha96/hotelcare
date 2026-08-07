ALTER TABLE public.pms_accounts
  ADD COLUMN IF NOT EXISTS status_push_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outbound_kill_switch boolean NOT NULL DEFAULT true;

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

  -- Legacy single-configuration tenants (Ottofiori / RD Hotels) — unchanged.
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

  -- Portfolio tenants (SLNT): resolve the owning PMS account through the
  -- unit mapping table.
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