-- Display human staff names in housekeeping manager-note audit entries.
-- Do not reveal usernames, nicknames with login suffixes, or staff email addresses.
-- Keep the existing authenticated room/hotel scope checks and RPC signatures.
CREATE OR REPLACE FUNCTION public.get_room_note_history(
  p_room_id uuid, p_limit integer DEFAULT 5
)
RETURNS TABLE (
  id uuid, content text, created_at timestamptz,
  created_by uuid, created_by_name text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_access_guest_request_room(p_room_id) THEN
    RAISE EXCEPTION 'Room is outside your hotel scope';
  END IF;

  RETURN QUERY
  SELECT hn.id, hn.content, hn.created_at, hn.created_by,
         NULLIF(BTRIM(p.full_name), '')::text AS created_by_name
  FROM public.housekeeping_notes hn
  LEFT JOIN public.profiles p ON p.id = hn.created_by
  WHERE hn.room_id = p_room_id
    AND hn.note_type = 'room_note_history'
  ORDER BY hn.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 5);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_room_note_provenance(
  p_room_id uuid, p_limit integer DEFAULT 5
)
RETURNS TABLE (
  id uuid, content text, created_at timestamptz,
  created_by uuid, created_by_name text, source text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.can_access_guest_request_room(p_room_id) THEN
    RAISE EXCEPTION 'Room is outside your hotel scope';
  END IF;

  RETURN QUERY
  WITH combined AS (
    SELECT hn.id, hn.content, hn.created_at, hn.created_by,
           NULLIF(BTRIM(p.full_name), '')::text AS created_by_name,
           'manual'::text AS source
    FROM public.housekeeping_notes hn
    LEFT JOIN public.profiles p ON p.id = hn.created_by
    WHERE hn.room_id = p_room_id AND hn.note_type = 'room_note_history'
    UNION ALL
    SELECT e.id, e.content, e.recorded_at AS created_at,
           NULL::uuid AS created_by,
           CASE WHEN e.source = 'first_seen'
             THEN 'Original author unknown' ELSE 'HotelCare system' END::text AS created_by_name,
           e.source
    FROM public.room_note_provenance_events e
    WHERE e.room_id = p_room_id
  )
  SELECT c.id, c.content, c.created_at, c.created_by, c.created_by_name, c.source
  FROM combined c
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 5);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_room_note_history(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_note_history(uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.get_room_note_provenance(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_note_provenance(uuid, integer) TO authenticated;
