-- Deliver manager instructions to the currently assigned housekeeper in real time.

ALTER TABLE public.room_assignments
  ADD COLUMN IF NOT EXISTS manager_instruction_text text,
  ADD COLUMN IF NOT EXISTS manager_instruction_updated_at timestamptz;

CREATE OR REPLACE FUNCTION public.hc_propagate_room_instruction_to_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instruction text := '';
  v_clean_notes text;
BEGIN
  IF NEW.notes IS NOT DISTINCT FROM OLD.notes
     AND NEW.towel_change_required IS NOT DISTINCT FROM OLD.towel_change_required
     AND NEW.linen_change_required IS NOT DISTINCT FROM OLD.linen_change_required THEN
    RETURN NEW;
  END IF;

  v_clean_notes := btrim(
    regexp_replace(
      coalesce(NEW.notes, ''),
      '\[(COLLECT_EXTRA_TOWELS|ROOM_CLEANING)\]\s*',
      '',
      'g'
    )
  );

  IF v_clean_notes <> '' THEN
    v_instruction := v_clean_notes;
  END IF;

  IF position('[ROOM_CLEANING]' in coalesce(NEW.notes, '')) > 0 THEN
    v_instruction := concat_ws(' · ', nullif(v_instruction, ''), 'Room cleaning requested');
  END IF;

  IF position('[COLLECT_EXTRA_TOWELS]' in coalesce(NEW.notes, '')) > 0 THEN
    v_instruction := concat_ws(' · ', nullif(v_instruction, ''), 'Collect extra towels');
  END IF;

  IF coalesce(NEW.towel_change_required, false) THEN
    v_instruction := concat_ws(' · ', nullif(v_instruction, ''), 'Towel change required');
  END IF;

  IF coalesce(NEW.linen_change_required, false) THEN
    v_instruction := concat_ws(' · ', nullif(v_instruction, ''), 'Linen change required');
  END IF;

  IF v_instruction = '' THEN
    v_instruction := 'Room instructions updated';
  END IF;

  UPDATE public.room_assignments
  SET manager_instruction_text = v_instruction,
      manager_instruction_updated_at = now(),
      updated_at = now()
  WHERE room_id = NEW.id
    AND assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
    AND status IN (
      'assigned'::public.assignment_status,
      'in_progress'::public.assignment_status,
      'dnd_pending_retry'::public.assignment_status
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hc_propagate_room_instruction ON public.rooms;
CREATE TRIGGER trg_hc_propagate_room_instruction
AFTER UPDATE OF notes, towel_change_required, linen_change_required ON public.rooms
FOR EACH ROW
WHEN (
  OLD.notes IS DISTINCT FROM NEW.notes
  OR OLD.towel_change_required IS DISTINCT FROM NEW.towel_change_required
  OR OLD.linen_change_required IS DISTINCT FROM NEW.linen_change_required
)
EXECUTE FUNCTION public.hc_propagate_room_instruction_to_assignment();

-- The room overview's "Message housekeeper" control historically inserted a
-- room-level housekeeping note with assignment_id = NULL. Attach it to today's
-- active assignee so the assigned-room card can actually receive it.
CREATE OR REPLACE FUNCTION public.hc_attach_housekeeping_note_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_id uuid;
BEGIN
  IF NEW.assignment_id IS NULL THEN
    SELECT ra.id
      INTO v_assignment_id
    FROM public.room_assignments ra
    WHERE ra.room_id = NEW.room_id
      AND ra.assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
      AND ra.status IN (
        'assigned'::public.assignment_status,
        'in_progress'::public.assignment_status,
        'dnd_pending_retry'::public.assignment_status
      )
    ORDER BY
      CASE ra.status
        WHEN 'in_progress'::public.assignment_status THEN 0
        WHEN 'assigned'::public.assignment_status THEN 1
        ELSE 2
      END,
      ra.updated_at DESC NULLS LAST,
      ra.id
    LIMIT 1;

    IF v_assignment_id IS NOT NULL THEN
      NEW.assignment_id := v_assignment_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hc_attach_housekeeping_note_assignment ON public.housekeeping_notes;
CREATE TRIGGER trg_hc_attach_housekeeping_note_assignment
BEFORE INSERT ON public.housekeeping_notes
FOR EACH ROW
EXECUTE FUNCTION public.hc_attach_housekeeping_note_assignment();

-- AssignedRoomCard already subscribes to housekeeping_notes, but the table was
-- not in the Supabase Realtime publication, so those subscriptions never fired.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'housekeeping_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.housekeeping_notes;
  END IF;
END
$$;
