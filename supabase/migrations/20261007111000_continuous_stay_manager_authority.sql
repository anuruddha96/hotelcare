-- Continuous-stay authority hardening.
--
-- 1) Keep a manager's same-day Checkout <-> Daily decision sticky during
--    ordinary PMS refreshes, BUT allow a verified strong-identity new guest
--    turnover to clear that stayover bridge.
-- 2) When a manager has already confirmed Checkout -> Daily for the business
--    date, mark the existing stay-extension review identity as verified so the
--    manager is not asked to "confirm with reception" again.

-- Scope guard: continuous-stay authority belongs only to Previo-connected
-- properties. This includes portfolio tenants such as SLNT that use active
-- Previo PMS accounts, while future/non-Previo PMS integrations remain untouched.
CREATE OR REPLACE FUNCTION public.hc_hotel_uses_previo(_hotel text, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF lower(coalesce(_meta ->> 'pmsProvider', '')) = 'previo' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.pms_configurations pc
    LEFT JOIN public.hotel_configurations hc ON hc.hotel_id = pc.hotel_id
    WHERE lower(coalesce(pc.pms_type, '')) = 'previo'
      AND (pc.hotel_id = _hotel OR hc.hotel_name = _hotel)
  ) OR EXISTS (
    SELECT 1
    FROM public.pms_accounts pa
    LEFT JOIN public.hotel_configurations hc ON hc.hotel_id = pa.hotel_id
    WHERE lower(coalesce(pa.pms_type, '')) = 'previo'
      AND coalesce(pa.is_active, true)
      AND (pa.hotel_id = _hotel OR hc.hotel_name = _hotel)
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.enforce_manual_room_type_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_meta jsonb := coalesce(OLD.pms_metadata, '{}'::jsonb);
  new_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  today_local date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  old_stamp text := old_meta ->> 'manual_moved_at';
  new_stamp text := new_meta ->> 'manual_moved_at';
  reset_reason text := new_meta ->> 'manualOverrideResetReason';
  reset_at text := new_meta ->> 'manualOverrideResetAt';
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
  IF NOT public.hc_hotel_uses_previo(NEW.hotel, new_meta) THEN
    RETURN NEW;
  END IF;

  -- A strong-identity PMS turnover is the one case allowed to invalidate a
  -- same-day stayover override. pmsRefresh emits this marker only after the
  -- Previo resolver has proved that the next arrival is a different guest.
  IF reset_reason = 'definitive_new_guest' THEN
    FOREACH key IN ARRAY ARRAY[
      'manual_moved_at','manual_moved_date','manual_moved_by',
      'manual_daily','manual_daily_at','manual_daily_by',
      'manual_checkout','manual_checkout_at','manual_checkout_by',
      'extensionServiceSnapshot','roomTypeChangeNotice'
    ] LOOP
      new_meta := new_meta - key;
    END LOOP;
    new_meta := new_meta - 'manualOverrideResetReason' - 'manualOverrideResetAt';
    new_meta := jsonb_set(new_meta, '{lastManualOverrideResetReason}', to_jsonb(reset_reason), true);
    new_meta := jsonb_set(
      new_meta,
      '{lastManualOverrideResetAt}',
      to_jsonb(coalesce(nullif(reset_at, ''), now()::text)),
      true
    );
    NEW.pms_metadata := new_meta;
    RETURN NEW;
  END IF;

  -- Browser timestamps are UTC instants. Convert them to the HOTEL business
  -- date before comparing; date-only/local timestamps keep their explicit day.
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
    new_meta := jsonb_set(new_meta, '{manual_moved_date}', to_jsonb(today_local::text), true);
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
    chosen_daily := old_daily AND NOT old_checkout;
    NEW.is_checkout_room := NOT chosen_daily;
    FOREACH key IN ARRAY ARRAY[
      'manual_moved_at','manual_moved_date','manual_moved_by',
      'manual_daily','manual_daily_at','manual_daily_by',
      'manual_checkout','manual_checkout_at','manual_checkout_by'
    ] LOOP
      IF old_meta ? key THEN
        new_meta := jsonb_set(new_meta, ARRAY[key], old_meta -> key, true);
      ELSE
        new_meta := new_meta - key;
      END IF;
    END LOOP;
  ELSE
    IF old_day IS NOT NULL AND old_day < today_local THEN
      FOREACH key IN ARRAY ARRAY[
        'manual_moved_at','manual_moved_date','manual_moved_by',
        'manual_daily','manual_daily_at','manual_daily_by',
        'manual_checkout','manual_checkout_at','manual_checkout_by'
      ] LOOP
        new_meta := new_meta - key;
      END LOOP;
    END IF;
    NEW.pms_metadata := new_meta;
    RETURN NEW;
  END IF;

  IF chosen_daily THEN
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

DROP TRIGGER IF EXISTS zzzzzzzz_hc_final_manual_room_type ON public.rooms;
CREATE TRIGGER zzzzzzzz_hc_final_manual_room_type
BEFORE UPDATE OF is_checkout_room, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_room_type_override();


CREATE OR REPLACE FUNCTION public.hc_manager_confirmation_day(_meta jsonb)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  explicit_day text := coalesce(_meta ->> 'manual_moved_date', '');
  stamp text := coalesce(_meta ->> 'manual_moved_at', '');
BEGIN
  IF explicit_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN explicit_day::date;
  END IF;
  IF stamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF stamp ~ '[Tt ][0-9]{2}:[0-9]{2}'
       AND stamp ~ '([zZ]|[+-][0-9]{2}(:?[0-9]{2})?)$' THEN
      RETURN (stamp::timestamptz AT TIME ZONE 'Europe/Budapest')::date;
    END IF;
    RETURN left(stamp, 10)::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN NULL;
  END;
END;
$function$;


CREATE OR REPLACE FUNCTION public.hc_mark_manager_confirmed_extension_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  meta jsonb;
  room_hotel text;
  move_day date;
  actor_text text;
  actor_id uuid;
BEGIN
  SELECT coalesce(r.pms_metadata, '{}'::jsonb), r.hotel
    INTO meta, room_hotel
  FROM public.rooms r
  WHERE r.id = NEW.room_id;

  IF meta IS NULL
     OR NOT public.hc_hotel_uses_previo(room_hotel, meta)
     OR coalesce(meta ->> 'manual_daily', 'false') <> 'true' THEN
    RETURN NEW;
  END IF;

  move_day := public.hc_manager_confirmation_day(meta);
  IF move_day IS NULL OR move_day <> NEW.business_date THEN
    RETURN NEW;
  END IF;

  actor_text := coalesce(meta ->> 'manual_moved_by', meta ->> 'manual_daily_by');
  IF coalesce(actor_text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    actor_id := actor_text::uuid;
  END IF;

  NEW.identity_status := 'verified';
  IF NEW.status = 'pending' THEN NEW.status := 'acknowledged'; END IF;
  NEW.acknowledged_at := coalesce(NEW.acknowledged_at, now());
  NEW.acknowledged_by := coalesce(NEW.acknowledged_by, actor_id);
  NEW.resolution_note := coalesce(
    NEW.resolution_note,
    'Guest stay already confirmed by manager in HotelCare'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzz_hc_manager_confirmed_extension_review
  ON public.housekeeping_stay_extension_reviews;
CREATE TRIGGER zzzzz_hc_manager_confirmed_extension_review
BEFORE INSERT OR UPDATE OF identity_status, status, business_date, room_id
ON public.housekeeping_stay_extension_reviews
FOR EACH ROW
EXECUTE FUNCTION public.hc_mark_manager_confirmed_extension_review();


CREATE OR REPLACE FUNCTION public.hc_verify_extension_review_after_room_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  old_meta jsonb := coalesce(OLD.pms_metadata, '{}'::jsonb);
  new_meta jsonb := coalesce(NEW.pms_metadata, '{}'::jsonb);
  move_day date;
  actor_text text;
  actor_id uuid;
BEGIN
  IF NOT public.hc_hotel_uses_previo(NEW.hotel, new_meta) THEN
    RETURN NEW;
  END IF;

  IF coalesce(new_meta ->> 'manual_daily', 'false') <> 'true'
     OR new_meta ->> 'manual_moved_at' IS NOT DISTINCT FROM old_meta ->> 'manual_moved_at'
  THEN
    RETURN NEW;
  END IF;

  move_day := public.hc_manager_confirmation_day(new_meta);
  IF move_day IS NULL THEN RETURN NEW; END IF;

  actor_text := coalesce(new_meta ->> 'manual_moved_by', new_meta ->> 'manual_daily_by');
  IF coalesce(actor_text, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    actor_id := actor_text::uuid;
  END IF;

  UPDATE public.housekeeping_stay_extension_reviews
  SET identity_status = 'verified',
      status = CASE WHEN status = 'pending' THEN 'acknowledged' ELSE status END,
      acknowledged_at = coalesce(acknowledged_at, now()),
      acknowledged_by = coalesce(acknowledged_by, actor_id),
      resolution_note = coalesce(
        resolution_note,
        'Guest stay already confirmed by manager in HotelCare'
      ),
      updated_at = now()
  WHERE room_id = NEW.id
    AND business_date = move_day
    AND status <> 'resolved';

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_hc_verify_extension_after_manager_move ON public.rooms;
CREATE TRIGGER zzz_hc_verify_extension_after_manager_move
AFTER UPDATE OF is_checkout_room, pms_metadata ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_verify_extension_review_after_room_move();

-- Backfill reviews that already existed before this migration but whose room
-- was already explicitly moved Checkout -> Daily by a manager today. Rewriting
-- identity_status to itself intentionally invokes the trigger above.
UPDATE public.housekeeping_stay_extension_reviews AS review
SET identity_status = review.identity_status
WHERE review.status <> 'resolved'
  AND EXISTS (
    SELECT 1
    FROM public.rooms r
    WHERE r.id = review.room_id
      AND public.hc_hotel_uses_previo(r.hotel, coalesce(r.pms_metadata, '{}'::jsonb))
      AND coalesce(r.pms_metadata ->> 'manual_daily', 'false') = 'true'
      AND public.hc_manager_confirmation_day(coalesce(r.pms_metadata, '{}'::jsonb)) = review.business_date
  );

-- Re-scope the original extension detector as well. The detector migration
-- predates multi-PMS support, so without this replacement a future non-Previo
-- integration could still create Previo-style continuity reviews.
DROP TRIGGER IF EXISTS zzz_hc_detect_stay_extension ON public.rooms;
CREATE TRIGGER zzz_hc_detect_stay_extension
AFTER UPDATE OF pms_metadata, guest_nights_stayed, is_checkout_room ON public.rooms
FOR EACH ROW WHEN (
  OLD.pms_metadata IS DISTINCT FROM NEW.pms_metadata
  AND public.hc_hotel_uses_previo(NEW.hotel, coalesce(NEW.pms_metadata, '{}'::jsonb))
)
EXECUTE FUNCTION public.hc_record_stay_extension_review();

REVOKE ALL ON FUNCTION public.hc_manager_confirmation_day(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hc_mark_manager_confirmed_extension_review() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hc_verify_extension_review_after_room_move() FROM PUBLIC;
