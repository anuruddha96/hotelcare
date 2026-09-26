CREATE OR REPLACE FUNCTION public.enforce_daily_cleaning_photos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  required_cats text[] := ARRAY['trash_bin', 'bathroom', 'bed', 'minibar', 'tea_coffee_table'];
  cat text;
  photo text;
  filename text;
  found boolean;
  is_gozsdu boolean := false;
  room_hotel text;
  manager_override_assignment text := current_setting('hotelcare.manager_clean_override_assignment', true);
  trusted_rpc_override boolean := false;
  direct_manager_override boolean := false;
BEGIN
  SELECT r.organization_slug = 'rdhotels'
         AND lower(trim(r.hotel)) IN ('gozsdu-court', 'gozsdu court budapest'),
         r.hotel
    INTO is_gozsdu, room_hotel
    FROM public.rooms AS r
   WHERE r.id = NEW.room_id;

  trusted_rpc_override :=
    manager_override_assignment = NEW.id::text
    AND auth.uid() IS NOT NULL
    AND NEW.supervisor_approved IS TRUE
    AND NEW.supervisor_approved_by = auth.uid()
    AND NEW.service_result = 'cleaned'
    AND COALESCE(NEW.is_dnd, false) = false
    AND public.get_user_role(auth.uid())::text IN (
      'admin', 'top_management', 'top_management_manager',
      'manager', 'housekeeping_manager', 'supervisor'
    )
    AND public.user_can_access_hotel(auth.uid(), room_hotel);

  direct_manager_override :=
    TG_OP = 'UPDATE'
    AND auth.uid() IS NOT NULL
    AND NEW.status = 'completed'
    AND NEW.completed_at IS DISTINCT FROM OLD.completed_at
    AND NEW.supervisor_approved IS TRUE
    AND NEW.supervisor_approved_by = auth.uid()
    AND NEW.service_result = 'cleaned'
    AND COALESCE(NEW.is_dnd, false) = false
    AND public.get_user_role(auth.uid())::text IN (
      'admin', 'top_management', 'top_management_manager',
      'manager', 'housekeeping_manager', 'supervisor'
    )
    AND public.user_can_access_hotel(auth.uid(), room_hotel);

  IF trusted_rpc_override OR direct_manager_override THEN
    NEW.notes := NULLIF(
      btrim(
        replace(
          replace(
            replace(COALESCE(NEW.notes, ''), '[NO_SERVICE]', '[OVERRIDDEN_NO_SERVICE]'),
            '[NO_BOARD_NO_CLEANING]', '[OVERRIDDEN_NO_BOARD_NO_CLEANING]'
          ),
          '[TOWEL_CHANGE_ONLY]', '[OVERRIDDEN_TOWEL_CHANGE_ONLY]'
        )
      ),
      ''
    );
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed'
     AND NEW.assignment_type = 'daily_cleaning'
     AND COALESCE(NEW.is_dnd, false) = false
     AND (NEW.notes IS NULL OR NEW.notes NOT LIKE '%[NO_SERVICE]%')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    IF COALESCE(is_gozsdu, false) THEN
      required_cats := ARRAY['trash_bin', 'bathroom', 'bed', 'tea_coffee_table'];
    END IF;

    IF NEW.completion_photos IS NULL OR cardinality(NEW.completion_photos) = 0 THEN
      RAISE EXCEPTION 'Cannot complete daily cleaning: required photos missing (%)', array_to_string(required_cats, ', ')
        USING ERRCODE = 'check_violation';
    END IF;

    FOREACH cat IN ARRAY required_cats LOOP
      found := false;
      FOREACH photo IN ARRAY NEW.completion_photos LOOP
        filename := split_part(photo, '/', array_length(string_to_array(photo, '/'), 1));
        IF left(filename, length(cat) + 1) = cat || '_' THEN
          found := true;
          EXIT;
        END IF;
      END LOOP;
      IF NOT found THEN
        RAISE EXCEPTION 'Cannot complete daily cleaning: missing required photo for category "%"', cat
          USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.capture_direct_manager_mark_clean_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_room public.rooms%ROWTYPE;
  v_now timestamptz := statement_timestamp();
  v_override_id uuid;
  v_rpc_assignment text := current_setting('hotelcare.manager_clean_override_assignment', true);
BEGIN
  IF v_rpc_assignment = NEW.id::text THEN
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE'
     OR v_actor IS NULL
     OR NEW.status::text <> 'completed'
     OR NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at
     OR NEW.supervisor_approved IS NOT TRUE
     OR NEW.supervisor_approved_by IS DISTINCT FROM v_actor
     OR NEW.service_result IS DISTINCT FROM 'cleaned'
     OR COALESCE(NEW.is_dnd, false) = true
  THEN
    RETURN NEW;
  END IF;

  SELECT p.full_name, p.role::text AS role, p.organization_slug,
         COALESCE(p.is_super_admin, false) AS is_super_admin
    INTO v_actor_profile
    FROM public.profiles p
   WHERE p.id = v_actor
     AND p.deleted_at IS NULL;

  IF NOT FOUND
     OR (NOT v_actor_profile.is_super_admin AND v_actor_profile.role NOT IN (
       'admin', 'top_management', 'top_management_manager',
       'manager', 'housekeeping_manager', 'supervisor'
     )) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_room
    FROM public.rooms
   WHERE id = NEW.room_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room disappeared while applying Manager Mark Clean.';
  END IF;

  IF NOT v_actor_profile.is_super_admin
     AND (
       v_room.organization_slug IS DISTINCT FROM v_actor_profile.organization_slug
       OR NOT public.user_can_access_hotel(v_actor, v_room.hotel)
     ) THEN
    RAISE EXCEPTION 'You do not have access to this hotel.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.rooms
     SET status = 'clean',
         last_cleaned_at = NEW.completed_at,
         last_cleaned_by = v_actor,
         is_dnd = false,
         dnd_marked_at = NULL,
         dnd_marked_by = NULL,
         updated_at = v_now
   WHERE id = NEW.room_id
   RETURNING * INTO v_room;

  INSERT INTO public.housekeeping_manager_clean_overrides (
    organization_slug, hotel_id, room_id, room_number,
    assignment_id, assignment_date,
    actor_id, actor_name, actor_role, source,
    before_state, after_state, created_at
  ) VALUES (
    v_room.organization_slug, v_room.hotel, v_room.id, v_room.room_number,
    NEW.id, NEW.assignment_date,
    v_actor, v_actor_profile.full_name, v_actor_profile.role, 'manager_ui_legacy_atomic',
    jsonb_build_object(
      'assignment', jsonb_build_object(
        'status', OLD.status,
        'service_result', OLD.service_result,
        'supervisor_approved', COALESCE(OLD.supervisor_approved, false),
        'is_dnd', COALESCE(OLD.is_dnd, false),
        'dnd_attempt_count', OLD.dnd_attempt_count,
        'notes', OLD.notes,
        'completed_at', OLD.completed_at,
        'completion_photo_count', COALESCE(cardinality(OLD.completion_photos), 0),
        'pms_hold', COALESCE(OLD.pms_hold, false)
      )
    ),
    jsonb_build_object(
      'room', jsonb_build_object(
        'status', v_room.status,
        'is_dnd', COALESCE(v_room.is_dnd, false),
        'last_cleaned_at', v_room.last_cleaned_at,
        'last_cleaned_by', v_room.last_cleaned_by
      ),
      'assignment', jsonb_build_object(
        'status', NEW.status,
        'service_result', NEW.service_result,
        'supervisor_approved', COALESCE(NEW.supervisor_approved, false),
        'supervisor_approved_by', NEW.supervisor_approved_by,
        'supervisor_approved_at', NEW.supervisor_approved_at,
        'is_dnd', COALESCE(NEW.is_dnd, false),
        'dnd_attempt_count', NEW.dnd_attempt_count,
        'notes', NEW.notes,
        'completed_at', NEW.completed_at,
        'completion_photo_count', COALESCE(cardinality(NEW.completion_photos), 0),
        'pms_hold', COALESCE(NEW.pms_hold, false)
      )
    ),
    v_now
  )
  RETURNING id INTO v_override_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_hc_capture_direct_manager_mark_clean_override ON public.room_assignments;
CREATE TRIGGER zzz_hc_capture_direct_manager_mark_clean_override
AFTER UPDATE OF status, completed_at, supervisor_approved, supervisor_approved_by, service_result, is_dnd, notes
ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.capture_direct_manager_mark_clean_override();

REVOKE ALL ON FUNCTION public.capture_direct_manager_mark_clean_override() FROM PUBLIC, anon, authenticated;
