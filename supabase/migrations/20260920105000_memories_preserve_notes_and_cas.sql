-- Guard against a same-stay PMS refresh or a partial snapshot discarding a
-- manager instruction. Genuine arrival/checkout transitions remain governed by
-- the established housekeeping lifecycle; explicit note-only clears still work.
CREATE OR REPLACE FUNCTION public.hotelcare_guard_memories_notes_on_refresh()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
DECLARE
  old_occupied text;
  new_occupied text;
  old_checkout text;
  new_checkout text;
BEGIN
  IF lower(btrim(coalesce(OLD.hotel, ''))) <> 'hotel memories budapest'
     OR NEW.pms_metadata IS NOT DISTINCT FROM OLD.pms_metadata
     OR nullif(btrim(coalesce(OLD.notes, '')), '') IS NULL
     OR NEW.notes IS NOT DISTINCT FROM OLD.notes THEN
    RETURN NEW;
  END IF;

  old_occupied := OLD.pms_metadata ->> 'occupiedToday';
  new_occupied := NEW.pms_metadata ->> 'occupiedToday';
  old_checkout := OLD.pms_metadata ->> 'checkedOutToday';
  new_checkout := NEW.pms_metadata ->> 'checkedOutToday';

  -- An incomplete snapshot is not evidence of a guest turnover. Never revive
  -- yesterday's instructions after an affirmative occupancy/checkout change.
  IF (new_occupied IS NULL OR new_occupied IS NOT DISTINCT FROM old_occupied)
     AND (new_checkout IS NULL OR new_checkout IS NOT DISTINCT FROM old_checkout)
     AND (NEW.pms_metadata ->> 'reservationStatusId' IS NULL
          OR NEW.pms_metadata ->> 'reservationStatusId'
             IS NOT DISTINCT FROM OLD.pms_metadata ->> 'reservationStatusId')
     AND OLD.notes !~ '^Previous guest bed setup:'
     AND (nullif(btrim(coalesce(NEW.notes, '')), '') IS NULL
          OR NEW.notes ~ '^Previous guest bed setup:') THEN
    NEW.notes := OLD.notes;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzzz_hotelcare_memories_notes_refresh_guard ON public.rooms;
CREATE TRIGGER zzzz_hotelcare_memories_notes_refresh_guard
BEFORE UPDATE OF notes, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hotelcare_guard_memories_notes_on_refresh();

-- The old save_room_note RPC is retained for callers not yet migrated.
-- New note editors use this conditional RPC to reject stale writes rather than
-- silently deleting another manager's more recent instructions.
CREATE OR REPLACE FUNCTION public.save_room_note_if_unchanged(
  p_room_id uuid, p_notes text, p_expected_notes text
)
RETURNS TABLE(room_id uuid, notes text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE
  v_role public.user_role;
  v_free_text text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  v_role := public.get_user_role(auth.uid());
  IF v_role IS NULL OR v_role <> ALL (ARRAY[
    'admin'::public.user_role, 'top_management'::public.user_role,
    'top_management_manager'::public.user_role, 'manager'::public.user_role,
    'housekeeping_manager'::public.user_role, 'supervisor'::public.user_role,
    'reception'::public.user_role, 'front_office'::public.user_role,
    'reception_manager'::public.user_role
  ]) THEN
    RAISE EXCEPTION 'Room note access denied';
  END IF;
  IF NOT public.can_access_guest_request_room(p_room_id) THEN
    RAISE EXCEPTION 'Room is outside your hotel scope';
  END IF;
  v_free_text := public.room_note_history_text(p_notes);
  RETURN QUERY
    UPDATE public.rooms r
    SET notes = NULLIF(concat_ws(' ',
      CASE WHEN coalesce(r.notes, '') LIKE '%[COLLECT_EXTRA_TOWELS]%' THEN '[COLLECT_EXTRA_TOWELS]' END,
      CASE WHEN coalesce(r.notes, '') LIKE '%[ROOM_CLEANING]%' THEN '[ROOM_CLEANING]' END,
      NULLIF(v_free_text, '')
    ), '')
    WHERE r.id = p_room_id
      AND r.notes IS NOT DISTINCT FROM p_expected_notes
    RETURNING r.id, r.notes, r.updated_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room notes changed since you opened them. Refresh the room and review the latest instructions before saving.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.save_room_note_if_unchanged(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_room_note_if_unchanged(uuid,text,text) TO authenticated;
