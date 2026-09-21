-- Fix incident #294: a PMS refresh made from a logged-in manager's browser
-- must never be interpreted as a manual bucket change just because it updated
-- is_checkout_room without changing metadata. The UI's deliberate switch
-- already includes an explicit manual_moved_at timestamp and matching flags.
-- Keep the final trigger as the sole guard; the duplicate early trigger adds
-- ordering ambiguity when other BEFORE triggers modify the same row.
DROP TRIGGER IF EXISTS trg_enforce_manual_room_type_override ON public.rooms;

CREATE OR REPLACE FUNCTION public.enforce_manual_room_type_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
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
  key text;
BEGIN
  -- Timestamp with an offset is a real instant. Bare date/local-wall-clock
  -- values retain their stated business date (legacy records).
  IF coalesce(old_stamp, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    BEGIN
      IF old_stamp ~ '[Tt ][0-9]{2}:[0-9]{2}'
         AND old_stamp ~ '([zZ]|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
        old_day := (old_stamp::timestamptz AT TIME ZONE 'Europe/Budapest')::date;
      ELSE old_day := left(old_stamp, 10)::date;
      END IF;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      old_day := NULL;
    END;
  END IF;
  IF coalesce(new_stamp, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    BEGIN
      IF new_stamp ~ '[Tt ][0-9]{2}:[0-9]{2}'
         AND new_stamp ~ '([zZ]|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
        new_day := (new_stamp::timestamptz AT TIME ZONE 'Europe/Budapest')::date;
      ELSE new_day := left(new_stamp, 10)::date;
      END IF;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      new_day := NULL;
    END;
  END IF;

  -- No implicit auth.uid() / flag-only fallback. A background PMS sync can
  -- run under a valid manager JWT; that does NOT make it a manager action.
  -- Legitimate manual UI switches send all of these fields together.
  fresh_manager_move :=
    new_day = today_local
    AND new_stamp IS DISTINCT FROM old_stamp
    AND NEW.is_checkout_room IS DISTINCT FROM OLD.is_checkout_room
    AND (
      (NEW.is_checkout_room IS TRUE
        AND new_meta ->> 'manual_checkout' = 'true'
        AND new_meta ->> 'manual_daily' = 'false')
      OR
      (NEW.is_checkout_room IS FALSE
        AND new_meta ->> 'manual_daily' = 'true'
        AND new_meta ->> 'manual_checkout' = 'false')
    );

  IF fresh_manager_move THEN
    chosen_daily := NEW.is_checkout_room IS FALSE;
    -- Preserve the explicit timestamp/actor/audit metadata as supplied by UI;
    -- never silently manufacture a manual override from a PMS write.
    IF chosen_daily THEN
      new_meta := jsonb_set(new_meta, '{manual_daily_at}', to_jsonb(new_stamp), true);
    ELSE
      new_meta := jsonb_set(new_meta, '{manual_checkout_at}', to_jsonb(new_stamp), true);
    END IF;
  ELSIF old_day = today_local AND (old_daily OR old_checkout) THEN
    -- Once a genuine manager action exists, later PMS imports must preserve it.
    chosen_daily := old_daily AND NOT old_checkout;
    NEW.is_checkout_room := NOT chosen_daily;
    FOREACH key IN ARRAY ARRAY[
      'manual_moved_at', 'manual_moved_by', 'manual_daily', 'manual_daily_at',
      'manual_daily_by', 'manual_checkout', 'manual_checkout_at', 'manual_checkout_by'
    ] LOOP
      IF old_meta ? key THEN
        new_meta := jsonb_set(new_meta, ARRAY[key], old_meta -> key, true);
      ELSE
        new_meta := new_meta - key;
      END IF;
    END LOOP;
  ELSE
    -- Prior-day overrides expire when that room is next updated.
    IF old_day IS NOT NULL AND old_day < today_local THEN
      FOREACH key IN ARRAY ARRAY[
        'manual_moved_at', 'manual_moved_by', 'manual_daily', 'manual_daily_at',
        'manual_daily_by', 'manual_checkout', 'manual_checkout_at', 'manual_checkout_by'
      ] LOOP
        new_meta := new_meta - key;
      END LOOP;
    END IF;
    NEW.pms_metadata := new_meta;
    RETURN NEW;
  END IF;

  IF chosen_daily THEN
    -- Presentation-only classification, not a fabricated guest departure.
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
