-- Preserve the exact housekeeping brief that a manager needs to review later.
--
-- Room rows remain editable throughout the day (manager notes, towel/linen
-- flags, DND state, bed setup, etc.). Approval cards therefore must not depend
-- only on the current room row after a housekeeper has started working.

ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS instruction_snapshot jsonb;

COMMENT ON COLUMN public.room_assignments.instruction_snapshot IS
  'Housekeeping instructions captured before work starts and frozen for supervisor approval/history.';

CREATE OR REPLACE FUNCTION public.build_room_assignment_instruction_snapshot(
  p_room_id text,
  p_assignment_type text,
  p_priority numeric,
  p_assignment_notes text,
  p_manager_instruction_text text,
  p_frozen boolean,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room_payload jsonb;
BEGIN
  SELECT to_jsonb(r)
    INTO room_payload
  FROM public.rooms r
  WHERE r.id::text = p_room_id
  LIMIT 1;

  IF room_payload IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_strip_nulls(
    jsonb_build_object(
      'version', 1,
      'source', p_source,
      'captured_at', timezone('utc', now()),
      'frozen', COALESCE(p_frozen, false),
      'assignment_type', p_assignment_type,
      'priority', p_priority,
      'assignment_notes', p_assignment_notes,
      -- Some deployments already carry a dedicated manager instruction field
      -- while older ones keep the instruction in room.notes. Reading it via
      -- to_jsonb makes this migration backward-compatible with both schemas.
      'manager_instruction_text', p_manager_instruction_text,
      'room', jsonb_strip_nulls(
        jsonb_build_object(
          'room_number', room_payload -> 'room_number',
          'hotel', room_payload -> 'hotel',
          'status', room_payload -> 'status',
          'room_name', room_payload -> 'room_name',
          'floor_number', room_payload -> 'floor_number',
          'towel_change_required', room_payload -> 'towel_change_required',
          'linen_change_required', room_payload -> 'linen_change_required',
          'guest_nights_stayed', room_payload -> 'guest_nights_stayed',
          'bed_configuration', room_payload -> 'bed_configuration',
          'notes', room_payload -> 'notes',
          'is_dnd', room_payload -> 'is_dnd',
          'dnd_marked_at', room_payload -> 'dnd_marked_at',
          'pms_metadata', jsonb_strip_nulls(
            jsonb_build_object(
              'manualBedConfig', (room_payload -> 'pms_metadata') -> 'manualBedConfig',
              'inferredBedConfig', (room_payload -> 'pms_metadata') -> 'inferredBedConfig'
            )
          )
        )
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_room_assignment_instruction_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  should_freeze boolean;
  snapshot_source text;
  assignment_payload jsonb;
BEGIN
  -- Once work started, the brief is historical evidence. Runtime completion
  -- notes may continue changing, but they must not rewrite what was requested.
  IF TG_OP = 'UPDATE'
     AND OLD.instruction_snapshot IS NOT NULL
     AND COALESCE((OLD.instruction_snapshot ->> 'frozen')::boolean, false)
  THEN
    NEW.instruction_snapshot := OLD.instruction_snapshot;
    RETURN NEW;
  END IF;

  assignment_payload := to_jsonb(NEW);
  should_freeze := NEW.started_at IS NOT NULL
    OR NEW.status::text IN ('in_progress', 'completed');

  snapshot_source := CASE
    WHEN should_freeze THEN 'assignment_start'
    WHEN TG_OP = 'INSERT' THEN 'assignment_create'
    ELSE 'assignment_update'
  END;

  NEW.instruction_snapshot := public.build_room_assignment_instruction_snapshot(
    NEW.room_id::text,
    NEW.assignment_type::text,
    NEW.priority,
    NEW.notes,
    assignment_payload ->> 'manager_instruction_text',
    should_freeze,
    snapshot_source
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_room_assignment_instruction_snapshot_trigger
  ON public.room_assignments;

CREATE TRIGGER capture_room_assignment_instruction_snapshot_trigger
BEFORE INSERT OR UPDATE
ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.capture_room_assignment_instruction_snapshot();

-- If a manager changes a room instruction before the housekeeper begins, keep
-- the unfrozen snapshot aligned with what the housekeeper will actually see.
CREATE OR REPLACE FUNCTION public.refresh_unfrozen_room_assignment_instruction_snapshots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.room_assignments a
  SET instruction_snapshot = public.build_room_assignment_instruction_snapshot(
    a.room_id::text,
    a.assignment_type::text,
    a.priority,
    a.notes,
    to_jsonb(a) ->> 'manager_instruction_text',
    false,
    'room_instruction_update'
  )
  WHERE a.room_id = NEW.id
    AND a.started_at IS NULL
    AND a.status::text NOT IN ('in_progress', 'completed', 'cancelled')
    AND NOT COALESCE((a.instruction_snapshot ->> 'frozen')::boolean, false);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_unfrozen_room_assignment_instruction_snapshots_trigger
  ON public.rooms;

CREATE TRIGGER refresh_unfrozen_room_assignment_instruction_snapshots_trigger
AFTER UPDATE OF
  status,
  room_name,
  floor_number,
  towel_change_required,
  linen_change_required,
  guest_nights_stayed,
  bed_configuration,
  notes,
  pms_metadata,
  is_dnd,
  dnd_marked_at
ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.refresh_unfrozen_room_assignment_instruction_snapshots();

-- Existing not-yet-started assignments can safely receive a live snapshot.
-- Completed/in-progress legacy assignments remain NULL so the UI can identify
-- them as legacy fallback data instead of presenting mutable room data as an
-- exact historical record.
UPDATE public.room_assignments a
SET instruction_snapshot = public.build_room_assignment_instruction_snapshot(
  a.room_id::text,
  a.assignment_type::text,
  a.priority,
  a.notes,
  to_jsonb(a) ->> 'manager_instruction_text',
  false,
  'migration_unstarted_backfill'
)
WHERE a.instruction_snapshot IS NULL
  AND a.started_at IS NULL
  AND a.status::text NOT IN ('in_progress', 'completed', 'cancelled');
