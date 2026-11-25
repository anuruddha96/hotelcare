-- Manager's Checkout/Daily correction remains authoritative throughout the
-- Budapest workday, across auto and human-triggered PMS synchronizations.
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
  -- Browser timestamps are UTC instants. Convert them to the HOTEL business
  -- date before comparing; 23:30Z is already tomorrow in Budapest. Date-only
  -- or local wall-clock stamps retain their explicitly recorded local date.
  IF coalesce(old_stamp, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    BEGIN
      IF old_stamp ~ '[Tt ][0-9]{2}:[0-9]{2}'
         AND old_stamp ~ '([zZ]|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
        old_day := (old_stamp::timestamptz AT TIME ZONE 'Europe/Budapest')::date;
      ELSE old_day := left(old_stamp, 10)::date;
      END IF;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN old_day := NULL;
    END;
  END IF;
  IF coalesce(new_stamp, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    BEGIN
      IF new_stamp ~ '[Tt ][0-9]{2}:[0-9]{2}'
         AND new_stamp ~ '([zZ]|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
        new_day := (new_stamp::timestamptz AT TIME ZONE 'Europe/Budapest')::date;
      ELSE new_day := left(new_stamp, 10)::date;
      END IF;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN new_day := NULL;
    END;
  END IF;

  -- A new manual timestamp + changed classification is an explicit user
  -- action. Also support a flag-only edit by an authenticated user; a PMS
  -- refresh normally changes metadata as well.
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
      THEN new_stamp
      ELSE to_char(now() AT TIME ZONE 'Europe/Budapest', 'YYYY-MM-DD"T"HH24:MI:SS') END;
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
    -- Restore manager's selection and audit if a PMS sync replaces entire
    -- pms_metadata, even if PMS currently says reservationStatusId 9.
    chosen_daily := old_daily AND NOT old_checkout;
    NEW.is_checkout_room := NOT chosen_daily;
    FOREACH key IN ARRAY ARRAY[
      'manual_moved_at','manual_moved_by','manual_daily','manual_daily_at',
      'manual_daily_by','manual_checkout','manual_checkout_at','manual_checkout_by'
    ] LOOP
      IF old_meta ? key THEN
        new_meta := jsonb_set(new_meta, ARRAY[key], old_meta -> key, true);
      ELSE new_meta := new_meta - key;
      END IF;
    END LOOP;
  ELSE
    -- Expire stale overrides only on the next day's room update/sync.
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
    -- Operational display only; leave raw PMS reservationStatusId and guest
    -- data intact for history/reconciliation.
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

-- PostgreSQL executes same-kind triggers alphabetically. This final guard
-- runs after existing property-specific, notes and legacy operational guards.
DROP TRIGGER IF EXISTS zzzzzzzz_hc_final_manual_room_type ON public.rooms;
CREATE TRIGGER zzzzzzzz_hc_final_manual_room_type
BEFORE UPDATE OF is_checkout_room, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_room_type_override();
