-- Repair legacy null-organization logging and never resurrect a guest with a recorded VIZA departure on a still-open stay; reconstruct completed stays as departed.
CREATE OR REPLACE FUNCTION public.viza_on_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  moment_at timestamptz;
  failure_state text;
  failure_message text;
BEGIN
  BEGIN
    IF current_setting('hotelcare.guest_lifecycle',true)='1' THEN RETURN NEW; END IF;
    moment_at:=COALESCE(NULLIF(current_setting('hotelcare.business_moment',true),'')::timestamptz,clock_timestamp());
    PERFORM public.pms_viza_apply_status_transition(NEW.id,OLD.status::text,
      NEW.status::text,moment_at);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS failure_state=RETURNED_SQLSTATE,
      failure_message=MESSAGE_TEXT;
    BEGIN
      INSERT INTO public.viza_trigger_failures
        (hotel_id,organization_slug,reservation_id,from_status,to_status,
         occurred_at,sqlstate,last_error)
      VALUES(NEW.hotel_id,COALESCE(NEW.organization_slug,(SELECT organization_slug FROM public.viza_settings WHERE hotel_id=NEW.hotel_id),''),NEW.id,
        OLD.status::text,NEW.status::text,COALESCE(moment_at,clock_timestamp()),
        failure_state,left(failure_message,500))
      ON CONFLICT (reservation_id,from_status,to_status)
        WHERE resolved_at IS NULL
      DO UPDATE SET attempts=public.viza_trigger_failures.attempts+1,
        sqlstate=EXCLUDED.sqlstate,last_error=EXCLUDED.last_error,
        occurred_at=EXCLUDED.occurred_at,updated_at=now();
    EXCEPTION WHEN OTHERS THEN
      -- Even failure-logging problems may never roll back check-in/out.
      RAISE WARNING 'VIZA failure log unavailable (reservation %): %',
        NEW.id,SQLERRM;
    END;
    -- A failing settings write must not roll back the durable failure row.
    BEGIN
      UPDATE public.viza_settings
      SET last_error=left('VIZA queue error for reservation '||NEW.id::text||
        ': '||failure_message,1000),updated_at=now()
      WHERE hotel_id=NEW.hotel_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'VIZA hotel status update unavailable (%): %',
        NEW.hotel_id,SQLERRM;
    END;
    RAISE WARNING 'viza_on_reservation_status (%): %',
      NEW.id,failure_message;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pms_rebuild_ntak_guest_states(_hotel_id text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE updated_rows integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ntak_settings
    WHERE hotel_id=_hotel_id AND enabled) THEN RETURN 0; END IF;

  UPDATE public.reservation_guests rg SET
    stay_state=CASE WHEN r.status='checked_out' THEN 'departed' ELSE 'in_house' END,
    arrived_at=COALESCE((SELECT ev.erkezes_ideje FROM public.viza_guest_events ev
      WHERE ev.reservation_id=r.id AND ev.guest_id=rg.guest_id
        AND ev.arrival_state IN ('queued','sent') LIMIT 1),r.actual_check_in,
      r.check_in_date::timestamp AT TIME ZONE 'Europe/Budapest'),
    departed_at=CASE WHEN r.status='checked_out'
      THEN COALESCE((SELECT ev.tavozas_ideje FROM public.viza_guest_events ev
        WHERE ev.reservation_id=r.id AND ev.guest_id=rg.guest_id
          AND ev.arrival_state IN ('queued','sent') LIMIT 1),r.actual_check_out,
        r.check_out_date::timestamp AT TIME ZONE 'Europe/Budapest')
      ELSE NULL END,
    room_id=COALESCE(rg.room_id,r.room_id)
  FROM public.reservations r
  JOIN public.ntak_settings cfg ON cfg.hotel_id=r.hotel_id AND cfg.enabled
  WHERE rg.reservation_id=r.id
    AND r.hotel_id=_hotel_id
    AND r.status IN ('checked_in','checked_out')
    AND rg.stay_state='expected' AND rg.arrived_at IS NULL
    AND (r.status <> 'checked_in' OR NOT EXISTS(SELECT 1 FROM public.viza_guest_events ev WHERE ev.reservation_id=r.id AND ev.guest_id=rg.guest_id AND ev.tavozas_ideje IS NOT NULL))
    AND (rg.is_primary OR rg.guest_id=r.guest_id OR EXISTS(
      SELECT 1 FROM public.viza_guest_events ev
      WHERE ev.reservation_id=r.id AND ev.guest_id=rg.guest_id
        AND ev.arrival_state IN ('queued','sent')))
    AND (
      cfg.unit_scope IS DISTINCT FROM 'profiled_only'
      OR (r.room_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_unit_profiles p
        WHERE p.hotel_id=r.hotel_id AND p.room_id=r.room_id AND p.active))
      OR (r.room_id IS NULL AND r.room_type_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.ntak_room_type_units t
        WHERE t.hotel_id=r.hotel_id AND t.room_type_id=r.room_type_id AND t.active))
    );

  GET DIAGNOSTICS updated_rows=ROW_COUNT;
  RETURN updated_rows;
END;
$$;
