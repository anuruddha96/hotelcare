-- Make room-note saves reliable across manager/supervisor views and retain a durable audit trail.

-- 1) Keep the existing room update policy but explicitly include portfolio management
--    and resolve hotel scope through either assigned_hotel or hotel_id/config mapping.
DROP POLICY IF EXISTS "Secure room updates" ON public.rooms;
CREATE POLICY "Secure room updates"
ON public.rooms
FOR UPDATE
TO public
USING (
  is_super_admin(auth.uid())
  OR (
    organization_slug = get_user_organization_slug(auth.uid())
    AND (
      get_user_role(auth.uid()) = ANY (ARRAY[
        'admin'::user_role,
        'top_management'::user_role,
        'top_management_manager'::user_role
      ])
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.assigned_hotel = rooms.hotel
            OR p.hotel_id = rooms.hotel
            OR EXISTS (
              SELECT 1
              FROM public.hotel_configurations hc
              WHERE (
                p.assigned_hotel = hc.hotel_id
                OR p.assigned_hotel = hc.hotel_name
                OR p.hotel_id = hc.hotel_id
                OR p.hotel_id = hc.hotel_name
              )
              AND (rooms.hotel = hc.hotel_id OR rooms.hotel = hc.hotel_name)
            )
          )
      )
    )
  )
);

-- 2) Strip service flags before comparing/storing human room-note history.
CREATE OR REPLACE FUNCTION public.room_note_history_text(p_notes text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        coalesce(p_notes, ''),
        '\[(COLLECT_EXTRA_TOWELS|ROOM_CLEANING)\]',
        '',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

-- 3) Capture every successful human free-text note change in housekeeping_notes.
--    SECURITY DEFINER is deliberate: the originating room UPDATE already passed
--    room RLS, and the audit insert must never fail because of a narrower notes policy.
CREATE OR REPLACE FUNCTION public.capture_room_note_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_old_text text;
  v_new_text text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  v_old_text := public.room_note_history_text(OLD.notes);
  v_new_text := public.room_note_history_text(NEW.notes);

  IF v_new_text IS DISTINCT FROM v_old_text THEN
    INSERT INTO public.housekeeping_notes (
      room_id,
      assignment_id,
      note_type,
      content,
      created_by,
      organization_slug,
      created_at,
      updated_at
    ) VALUES (
      NEW.id,
      NULL,
      'room_note_history',
      CASE WHEN v_new_text = '' THEN '[Note cleared]' ELSE v_new_text END,
      v_actor,
      NEW.organization_slug,
      now(),
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_room_note_history ON public.rooms;
CREATE TRIGGER trg_capture_room_note_history
AFTER UPDATE OF notes ON public.rooms
FOR EACH ROW
WHEN (OLD.notes IS DISTINCT FROM NEW.notes)
EXECUTE FUNCTION public.capture_room_note_history();

REVOKE ALL ON FUNCTION public.capture_room_note_history() FROM PUBLIC;

CREATE INDEX IF NOT EXISTS idx_housekeeping_notes_room_note_history
ON public.housekeeping_notes (room_id, created_at DESC)
WHERE note_type = 'room_note_history';

-- 4) Save notes through a single verified RPC. This avoids the former failure mode
--    where PostgREST returned no error even though RLS affected zero rows.
CREATE OR REPLACE FUNCTION public.save_room_note(
  p_room_id uuid,
  p_notes text
)
RETURNS TABLE (
  room_id uuid,
  notes text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_role := get_user_role(auth.uid());

  IF v_role <> ALL (ARRAY[
    'admin'::user_role,
    'top_management'::user_role,
    'top_management_manager'::user_role,
    'manager'::user_role,
    'housekeeping_manager'::user_role,
    'supervisor'::user_role,
    'reception'::user_role,
    'front_office'::user_role,
    'reception_manager'::user_role
  ]) THEN
    RAISE EXCEPTION 'Room note access denied';
  END IF;

  IF NOT can_access_guest_request_room(p_room_id) THEN
    RAISE EXCEPTION 'Room is outside your hotel scope';
  END IF;

  RETURN QUERY
  UPDATE public.rooms r
  SET notes = NULLIF(btrim(coalesce(p_notes, '')), '')
  WHERE r.id = p_room_id
  RETURNING r.id, r.notes, r.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room note update was not applied';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_room_note(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_room_note(uuid, text) TO authenticated;

-- 5) Read only the five most recent immutable note-history rows, with author labels.
CREATE OR REPLACE FUNCTION public.get_room_note_history(
  p_room_id uuid,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  created_at timestamptz,
  created_by uuid,
  created_by_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT can_access_guest_request_room(p_room_id) THEN
    RAISE EXCEPTION 'Room is outside your hotel scope';
  END IF;

  RETURN QUERY
  SELECT
    hn.id,
    hn.content,
    hn.created_at,
    hn.created_by,
    coalesce(nullif(p.nickname, ''), nullif(p.full_name, ''), p.email, 'Unknown user')::text
  FROM public.housekeeping_notes hn
  LEFT JOIN public.profiles p ON p.id = hn.created_by
  WHERE hn.room_id = p_room_id
    AND hn.note_type = 'room_note_history'
  ORDER BY hn.created_at DESC
  LIMIT LEAST(GREATEST(coalesce(p_limit, 5), 1), 5);
END;
$$;

REVOKE ALL ON FUNCTION public.get_room_note_history(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_note_history(uuid, integer) TO authenticated;

-- History rows are audit records; prevent edits/deletes regardless of permissive legacy policies.
CREATE OR REPLACE FUNCTION public.protect_room_note_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.note_type = 'room_note_history' THEN
    RAISE EXCEPTION 'Room note history is immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_room_note_history_update ON public.housekeeping_notes;
CREATE TRIGGER trg_protect_room_note_history_update
BEFORE UPDATE ON public.housekeeping_notes
FOR EACH ROW
EXECUTE FUNCTION public.protect_room_note_history();

DROP TRIGGER IF EXISTS trg_protect_room_note_history_delete ON public.housekeeping_notes;
CREATE TRIGGER trg_protect_room_note_history_delete
BEFORE DELETE ON public.housekeeping_notes
FOR EACH ROW
EXECUTE FUNCTION public.protect_room_note_history();
