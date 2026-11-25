-- Capture reliable provenance for room notes changed by backend jobs, and baseline
-- older notes without falsely attributing an original entry date or author.
-- Production migration: 20261024064507, applied 2026-10-24.
-- Never edits rooms.notes, assignments, bed setups or old note history.
CREATE TABLE IF NOT EXISTS public.room_note_provenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  organization_slug text,
  content text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('first_seen', 'system_change', 'room_created'))
);
CREATE INDEX IF NOT EXISTS idx_room_note_provenance_events_room_date
 ON public.room_note_provenance_events (room_id, recorded_at DESC);
ALTER TABLE public.room_note_provenance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_note_provenance_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hc_capture_system_room_note_provenance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
 v_old_text text;
 v_new_text text := public.room_note_history_text(NEW.notes);
BEGIN
 IF TG_OP = 'UPDATE' THEN
   -- The existing authenticated human-note audit continues to own these changes.
   IF auth.uid() IS NOT NULL THEN RETURN NEW; END IF;
   v_old_text := public.room_note_history_text(OLD.notes);
 ELSE
   v_old_text := '';
 END IF;
 IF v_new_text IS DISTINCT FROM v_old_text THEN
   INSERT INTO public.room_note_provenance_events
     (room_id, organization_slug, content, recorded_at, source)
   VALUES
     (NEW.id, NEW.organization_slug,
      CASE WHEN v_new_text = '' THEN '[Note cleared]' ELSE v_new_text END,
      statement_timestamp(),
      CASE WHEN TG_OP = 'INSERT' THEN 'room_created' ELSE 'system_change' END);
 END IF;
 RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_hc_capture_system_room_note_provenance ON public.rooms;
CREATE TRIGGER trg_hc_capture_system_room_note_provenance
 AFTER INSERT OR UPDATE OF notes ON public.rooms
 FOR EACH ROW EXECUTE FUNCTION public.hc_capture_system_room_note_provenance();
REVOKE ALL ON FUNCTION public.hc_capture_system_room_note_provenance() FROM PUBLIC, anon, authenticated;

-- Baseline missing current-note audit evidence from actual historical snapshots
-- when available. An observation is not proof of who entered a note or when.
INSERT INTO public.room_note_provenance_events
  (room_id, organization_slug, content, recorded_at, source)
SELECT
  r.id, r.organization_slug, public.room_note_history_text(r.notes),
  coalesce((
    SELECT min(s.captured_at)
    FROM public.housekeeping_room_snapshots s
    WHERE s.room_id = r.id
      AND public.room_note_history_text(s.room_notes)
          = public.room_note_history_text(r.notes)
  ), statement_timestamp()),
  'first_seen'
FROM public.rooms r
WHERE public.room_note_history_text(r.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.housekeeping_notes hn
    WHERE hn.room_id = r.id AND hn.note_type = 'room_note_history'
      AND public.room_note_history_text(hn.content)
          = public.room_note_history_text(r.notes)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.room_note_provenance_events e
    WHERE e.room_id = r.id AND e.source = 'first_seen'
      AND public.room_note_history_text(e.content)
          = public.room_note_history_text(r.notes)
  );

-- Authenticated API only; tenant/hotel access is rechecked in the database.
-- Separate provenance table is RLS-protected and not exposed for direct reads.
CREATE OR REPLACE FUNCTION public.get_room_note_provenance(
 p_room_id uuid, p_limit integer DEFAULT 5
)
RETURNS TABLE (
 id uuid, content text, created_at timestamptz, created_by uuid,
 created_by_name text, source text
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
     coalesce(nullif(p.nickname, ''), nullif(p.full_name, ''),
              p.email, 'Unknown user')::text AS created_by_name,
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
 LIMIT LEAST(GREATEST(coalesce(p_limit, 5), 1), 5);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_room_note_provenance(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_note_provenance(uuid, integer) TO authenticated;
