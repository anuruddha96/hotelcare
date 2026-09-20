-- A manager's Checkout/Daily correction is the operational source of truth
-- for the Budapest workday. Automatic AND person-initiated PMS refreshes must
-- not silently replace it. On the next workday, the next PMS refresh may
-- return the room to its PMS-derived state. Preserve raw reservation status.
CREATE OR REPLACE FUNCTION public.enforce_manual_room_type_override()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  old_meta jsonb := coalesce(OLD.pms_metadata, '{}'::jsonb);
  new_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  today_local date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  old_stamp text := old_meta ->> 'manual_moved_at';
  new_stamp text := new_meta ->> 'manual_moved_at';
  old_day date;
  new_day date;
  fresh_manager_move boolean := false;
  old_daily boolean := old_meta ->> 'manual_daily' = 'true';
  old_checkout boolean := old_meta ->> 'manual_checkout' = 'true';
  chosen_daily boolean;
  actor text;
  marker text;
  key text;
BEGIN
  -- Read the local date defensively; malformed legacy timestamps never hold
  -- a room override indefinitely.
  IF coalesce(old_stamp, '') ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN old_day := left(old_stamp, 10)::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN old_day := NULL;
    END;
  END IF;
  IF coalesce(new_stamp, '') ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN new_day := left(new_stamp, 10)::date;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN new_day := NULL;
    END;
  END IF;

  -- Existing manager UI supplies a new manual_moved_at with a room-type
  -- change. Also support a simple authenticated flag-only manager edit;
  -- a PMS refresh normally updates PMS metadata, so cannot mimic that edit.
  fresh_manager_move := (
    new_day = today_local AND new_stamp IS DISTINCT FROM old_stamp
    AND NEW.is_checkout_room IS DISTINCT FROM OLD.is_checkout_room
  ) OR (
    NEW.is_checkout_room IS DISTINCT FROM OLD.is_checkout_room
    AND NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata
    AND auth.uid() IS NOT NULL
  );

  IF fresh_manager_move THEN
    chosen_daily := NOT coalesce(NEW.is_checkout_room, false);
    marker := CASE WHEN new_day = today_local AND new_stamp IS DISTINCT FROM old_stamp
      THEN new_stamp ELSE now()::text END;
    actor := coalesce(nullif(new_meta ->> 'manual_moved_by', ''), auth.uid()::text);
    new_meta := jsonb_set(new_meta, '{manual_moved_at}', to_jsonb(marker), true);
    IF actor IS NOT NULL THEN
      new_meta := jsonb_set(new_meta, '{manual_moved_by}', to_jsonb(actor), true);
    END IF;
    new_meta := jsonb_set(new_meta, '{manual_daily}', to_jsonb(chosen_daily), true);
    new_meta := jsonb_set(new_meta, '{manual_checkout}', to_jsonb(NOT chosen_daily), true);
    IF chosen_daily THEN
      new_meta := jsonb_set(new_meta, '{manual_daily_at}', to_jsonb(marker), true);
      IF actor IS NOT NULL THEN
        new_meta := jsonb_set(new_meta, '{manual_daily_by}', to_jsonb(actor), true);
      END IF;
    ELSE
      new_meta := jsonb_set(new_meta, '{manual_checkout_at}', to_jsonb(marker), true);
      IF actor IS NOT NULL THEN
        new_meta := jsonb_set(new_meta, '{manual_checkout_by}', to_jsonb(actor), true);
      END IF;
    END IF;
  ELSIF old_day = today_local AND (old_daily OR old_checkout) THEN
    -- PMS may replace the entire metadata document: restore the manager's
    -- decision and audit markers, even if PMS currently says status 9.
    chosen_daily := old_daily AND NOT old_checkout;
    NEW.is_checkout_room := NOT chosen_daily;
    FOREACH key IN ARRAY ARRAY[
      'manual_moved_at','manual_moved_by','manual_daily','manual_daily_at',
      'manual_daily_by','manual_checkout','manual_checkout_at','manual_checkout_by'
    ] LOOP
      IF old_meta ? key THEN
        new_meta := jsonb_set(new_meta, ARRAY[key], old_meta -> key, true);
      ELSE
        new_meta := new_meta - key;
      END IF;
    END LOOP;
  ELSE
    -- Yesterday's choice expires at the next sync, never at the next sync
    -- occurring later on the same date. No assumptions about PMS identities.
    IF old_day IS NOT NULL AND old_day < today_local THEN
      FOREACH key IN ARRAY ARRAY[
        'manual_moved_at','manual_moved_by','manual_daily','manual_daily_at',
        'manual_daily_by','manual_checkout','manual_checkout_at','manual_checkout_by'
      ] LOOP
        new_meta := new_meta - key;
      END LOOP;
    END IF;
    NEW.pms_metadata := new_meta;
    RETURN NEW;
  END IF;

  IF chosen_daily THEN
    -- Operational display hints only. Keep reservationStatusId and all raw
    -- PMS guest/booking information for audit and subsequent reconciliation.
    new_meta := jsonb_set(new_meta, '{scheduledDepartureToday}', 'false'::jsonb, true);
    new_meta := jsonb_set(new_meta, '{checkedOutToday}', 'false'::jsonb, true);
    new_meta := jsonb_set(new_meta, '{readyToClean}', 'false'::jsonb, true);
    new_meta := jsonb_set(new_meta, '{departureTime}', 'null'::jsonb, true);
    NEW.is_checkout_room := false;
  ELSE
    NEW.is_checkout_room := true;
  END IF;
  NEW.pms_metadata := new_meta;
  RETURN NEW;
END;
$function$;

-- BEFORE triggers execute alphabetically. Existing Gozsdu/notes/status
-- triggers run after trg_enforce_manual_room_type_override; this last guard
-- guarantees that none can reset a current-day manager decision afterwards.
DROP TRIGGER IF EXISTS zzzzzzzz_hc_final_manual_room_type ON public.rooms;
CREATE TRIGGER zzzzzzzz_hc_final_manual_room_type
BEFORE UPDATE OF is_checkout_room, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_room_type_override();
