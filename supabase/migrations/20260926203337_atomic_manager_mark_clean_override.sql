CREATE TABLE IF NOT EXISTS public.housekeeping_manager_clean_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  room_id uuid NOT NULL,
  room_number text NOT NULL,
  assignment_id uuid,
  assignment_date date,
  actor_id uuid NOT NULL,
  actor_name text,
  actor_role text NOT NULL,
  source text NOT NULL DEFAULT 'manager_ui',
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hk_manager_clean_overrides_room_created
  ON public.housekeeping_manager_clean_overrides (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hk_manager_clean_overrides_assignment
  ON public.housekeeping_manager_clean_overrides (assignment_id)
  WHERE assignment_id IS NOT NULL;

ALTER TABLE public.housekeeping_manager_clean_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view clean override audit" ON public.housekeeping_manager_clean_overrides;
CREATE POLICY "Managers can view clean override audit"
ON public.housekeeping_manager_clean_overrides
FOR SELECT
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND public.get_user_role(auth.uid())::text IN (
      'admin', 'top_management', 'top_management_manager',
      'manager', 'housekeeping_manager', 'supervisor'
    )
    AND public.user_can_access_hotel(auth.uid(), hotel_id)
  )
);

REVOKE ALL ON public.housekeeping_manager_clean_overrides FROM anon, authenticated;
GRANT SELECT ON public.housekeeping_manager_clean_overrides TO authenticated;

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
  manager_override_assignment text := current_setting('hotelcare.manager_clean_override_assignment', true);
BEGIN
  IF NEW.status = 'completed'
     AND NEW.assignment_type = 'daily_cleaning'
     AND COALESCE(NEW.is_dnd, false) = false
     AND (NEW.notes IS NULL OR NEW.notes NOT LIKE '%[NO_SERVICE]%')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
  THEN
    IF manager_override_assignment = NEW.id::text
       AND auth.uid() IS NOT NULL
       AND NEW.supervisor_approved IS TRUE
       AND NEW.supervisor_approved_by = auth.uid()
       AND NEW.service_result = 'cleaned'
       AND public.get_user_role(auth.uid())::text IN (
         'admin', 'top_management', 'top_management_manager',
         'manager', 'housekeeping_manager', 'supervisor'
       )
    THEN
      RETURN NEW;
    END IF;

    SELECT r.organization_slug = 'rdhotels'
           AND lower(trim(r.hotel)) IN ('gozsdu-court', 'gozsdu court budapest')
      INTO is_gozsdu
      FROM public.rooms AS r
     WHERE r.id = NEW.room_id;

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

CREATE OR REPLACE FUNCTION public.manager_mark_room_clean(
  p_room_id uuid,
  p_assignment_id uuid DEFAULT NULL,
  p_expected_assignment_date date DEFAULT NULL,
  p_source text DEFAULT 'manager_ui'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_room public.rooms%ROWTYPE;
  v_assignment public.room_assignments%ROWTYPE;
  v_assignment_after public.room_assignments%ROWTYPE;
  v_now timestamptz := statement_timestamp();
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_has_assignment boolean := false;
  v_notes text;
  v_before jsonb;
  v_after jsonb;
  v_override_id uuid;
  v_source text := left(COALESCE(NULLIF(btrim(p_source), ''), 'manager_ui'), 64);
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to mark a room clean.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.full_name, p.role::text AS role, p.organization_slug,
         COALESCE(p.is_super_admin, false) AS is_super_admin
    INTO v_actor_profile
    FROM public.profiles p
   WHERE p.id = v_actor
     AND p.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your staff profile is not available.' USING ERRCODE = '42501';
  END IF;

  IF NOT v_actor_profile.is_super_admin
     AND v_actor_profile.role NOT IN (
       'admin', 'top_management', 'top_management_manager',
       'manager', 'housekeeping_manager', 'supervisor'
     ) THEN
    RAISE EXCEPTION 'Only a manager or housekeeping supervisor can use Mark Clean override.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_room
    FROM public.rooms
   WHERE id = p_room_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected room no longer exists.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_actor_profile.is_super_admin THEN
    IF v_room.organization_slug IS DISTINCT FROM v_actor_profile.organization_slug
       OR NOT public.user_can_access_hotel(v_actor, v_room.hotel) THEN
      RAISE EXCEPTION 'You do not have access to this hotel.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_expected_assignment_date IS NOT NULL AND p_expected_assignment_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'Manager Mark Clean can only be used for today''s housekeeping work.' USING ERRCODE = '22023';
  END IF;

  IF p_assignment_id IS NOT NULL THEN
    SELECT * INTO v_assignment
      FROM public.room_assignments
     WHERE id = p_assignment_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The housekeeping assignment changed. Refresh the room and try again.' USING ERRCODE = 'P0002';
    END IF;

    IF v_assignment.room_id IS DISTINCT FROM p_room_id THEN
      RAISE EXCEPTION 'The housekeeping assignment does not belong to this room.' USING ERRCODE = '22023';
    END IF;

    IF v_assignment.organization_slug IS DISTINCT FROM v_room.organization_slug THEN
      RAISE EXCEPTION 'The housekeeping assignment belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    IF v_assignment.assignment_date IS DISTINCT FROM v_today
       OR (p_expected_assignment_date IS NOT NULL
           AND v_assignment.assignment_date IS DISTINCT FROM p_expected_assignment_date) THEN
      RAISE EXCEPTION 'The housekeeping assignment is not for today. Refresh the room before overriding it.' USING ERRCODE = '22023';
    END IF;

    v_has_assignment := true;
  END IF;

  IF v_room.status = 'clean'
     AND COALESCE(v_room.is_dnd, false) = false
     AND (
       NOT v_has_assignment
       OR (
         v_assignment.status::text = 'completed'
         AND v_assignment.supervisor_approved IS TRUE
         AND COALESCE(v_assignment.is_dnd, false) = false
         AND v_assignment.service_result = 'cleaned'
         AND COALESCE(v_assignment.notes, '') NOT LIKE '%[NO_SERVICE]%'
         AND COALESCE(v_assignment.notes, '') NOT LIKE '%[TOWEL_CHANGE_ONLY]%'
       )
     ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_clean', true,
      'room_id', p_room_id,
      'assignment_id', p_assignment_id,
      'overridden_at', COALESCE(v_assignment.supervisor_approved_at, v_room.last_cleaned_at, v_now)
    );
  END IF;

  v_before := jsonb_build_object(
    'room', jsonb_build_object(
      'status', v_room.status,
      'is_dnd', COALESCE(v_room.is_dnd, false),
      'last_cleaned_at', v_room.last_cleaned_at,
      'last_cleaned_by', v_room.last_cleaned_by
    ),
    'assignment', CASE WHEN v_has_assignment THEN jsonb_build_object(
      'status', v_assignment.status,
      'service_result', v_assignment.service_result,
      'supervisor_approved', COALESCE(v_assignment.supervisor_approved, false),
      'is_dnd', COALESCE(v_assignment.is_dnd, false),
      'dnd_attempt_count', v_assignment.dnd_attempt_count,
      'notes', v_assignment.notes,
      'completed_at', v_assignment.completed_at,
      'completion_photo_count', COALESCE(cardinality(v_assignment.completion_photos), 0),
      'pms_hold', COALESCE(v_assignment.pms_hold, false)
    ) ELSE NULL END
  );

  IF v_has_assignment THEN
    v_notes := NULLIF(
      btrim(
        replace(
          replace(
            replace(COALESCE(v_assignment.notes, ''), '[NO_SERVICE]', '[OVERRIDDEN_NO_SERVICE]'),
            '[NO_BOARD_NO_CLEANING]', '[OVERRIDDEN_NO_BOARD_NO_CLEANING]'
          ),
          '[TOWEL_CHANGE_ONLY]', '[OVERRIDDEN_TOWEL_CHANGE_ONLY]'
        )
      ),
      ''
    );

    PERFORM set_config('hotelcare.manager_clean_override_assignment', v_assignment.id::text, true);

    UPDATE public.room_assignments
       SET status = 'completed',
           completed_at = v_now,
           supervisor_approved = true,
           supervisor_approved_by = v_actor,
           supervisor_approved_at = v_now,
           service_result = 'cleaned',
           is_dnd = false,
           dnd_marked_at = NULL,
           dnd_marked_by = NULL,
           dnd_attempt_count = 0,
           dnd_first_attempt_at = NULL,
           dnd_retry_unlocked_at = NULL,
           pms_hold = false,
           pms_hold_reason = NULL,
           pms_hold_event_id = NULL,
           notes = v_notes
     WHERE id = v_assignment.id
     RETURNING * INTO v_assignment_after;
  END IF;

  UPDATE public.rooms
     SET status = 'clean',
         last_cleaned_at = v_now,
         last_cleaned_by = v_actor,
         is_dnd = false,
         dnd_marked_at = NULL,
         dnd_marked_by = NULL,
         updated_at = v_now
   WHERE id = p_room_id
   RETURNING * INTO v_room;

  v_after := jsonb_build_object(
    'room', jsonb_build_object(
      'status', v_room.status,
      'is_dnd', COALESCE(v_room.is_dnd, false),
      'last_cleaned_at', v_room.last_cleaned_at,
      'last_cleaned_by', v_room.last_cleaned_by
    ),
    'assignment', CASE WHEN v_has_assignment THEN jsonb_build_object(
      'status', v_assignment_after.status,
      'service_result', v_assignment_after.service_result,
      'supervisor_approved', COALESCE(v_assignment_after.supervisor_approved, false),
      'supervisor_approved_by', v_assignment_after.supervisor_approved_by,
      'supervisor_approved_at', v_assignment_after.supervisor_approved_at,
      'is_dnd', COALESCE(v_assignment_after.is_dnd, false),
      'dnd_attempt_count', v_assignment_after.dnd_attempt_count,
      'notes', v_assignment_after.notes,
      'completed_at', v_assignment_after.completed_at,
      'completion_photo_count', COALESCE(cardinality(v_assignment_after.completion_photos), 0),
      'pms_hold', COALESCE(v_assignment_after.pms_hold, false)
    ) ELSE NULL END
  );

  INSERT INTO public.housekeeping_manager_clean_overrides (
    organization_slug, hotel_id, room_id, room_number,
    assignment_id, assignment_date,
    actor_id, actor_name, actor_role, source,
    before_state, after_state, created_at
  ) VALUES (
    v_room.organization_slug, v_room.hotel, v_room.id, v_room.room_number,
    CASE WHEN v_has_assignment THEN v_assignment.id ELSE NULL END,
    CASE WHEN v_has_assignment THEN v_assignment.assignment_date ELSE v_today END,
    v_actor, v_actor_profile.full_name, v_actor_profile.role, v_source,
    v_before, v_after, v_now
  )
  RETURNING id INTO v_override_id;

  RETURN jsonb_build_object(
    'success', true,
    'already_clean', false,
    'override_id', v_override_id,
    'room_id', p_room_id,
    'assignment_id', CASE WHEN v_has_assignment THEN v_assignment.id ELSE NULL END,
    'overridden_at', v_now,
    'assignment_notes', CASE WHEN v_has_assignment THEN v_assignment_after.notes ELSE NULL END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.manager_mark_room_clean(uuid, uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_mark_room_clean(uuid, uuid, date, text) TO authenticated;
