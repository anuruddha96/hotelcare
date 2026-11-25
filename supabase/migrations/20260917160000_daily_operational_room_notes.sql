-- Daily operational notes: visible for the local working day, then cleared from
-- active rooms at local midnight. Immutable housekeeping_notes history is kept.
-- This is shared by all organizations; room RLS and room IDs remain unchanged.
-- HotelCare's configured operating timezone is Europe/Budapest.

-- A non-destructive rollout: existing notes receive today's working date via
-- a one-time column default (no UPDATE and no housekeeping status triggers).
-- Fresh rows must not inherit that default, hence remove it immediately.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS operational_note_date date
  DEFAULT ((now() AT TIME ZONE 'Europe/Budapest')::date);
ALTER TABLE public.rooms ALTER COLUMN operational_note_date DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_rooms_operational_note_expiry
  ON public.rooms (operational_note_date)
  WHERE operational_note_date IS NOT NULL AND notes IS NOT NULL;

CREATE OR REPLACE FUNCTION public.hc_preserve_workday_room_notes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_old_text text := public.room_note_history_text(OLD.notes);
  v_new_text text := public.room_note_history_text(NEW.notes);
BEGIN
  -- The Excel PMS uploader explicitly sets updated_at and carries
  -- pmsUploadDate. That source owns reservation metadata, NOT manager notes.
  -- Reject its attempt to overwrite a manager note (even if the Note cell is
  -- blank). The uploader may continue changing separate status/service fields.
  IF NEW.notes IS DISTINCT FROM OLD.notes
    AND coalesce(NEW.pms_metadata, '{}'::jsonb) ? 'pmsUploadDate'
    AND (
      NEW.updated_at IS DISTINCT FROM OLD.updated_at
      OR NEW.pms_metadata IS DISTINCT FROM OLD.pms_metadata
    )
  THEN
    NEW.notes := OLD.notes;
    NEW.operational_note_date := OLD.operational_note_date;
    RETURN NEW;
  END IF;

  -- Prevent a dialog left open overnight from re-saving yesterday's full note.
  -- Fresh text entered in the new day and deliberate blanking are permitted.
  IF auth.uid() IS NOT NULL
    AND OLD.operational_note_date IS NOT NULL
    AND OLD.operational_note_date < v_today
    AND v_old_text <> ''
    AND v_new_text <> ''
    AND position(v_old_text IN v_new_text) > 0
    AND v_new_text IS DISTINCT FROM v_old_text
  THEN
    RAISE EXCEPTION 'The previous working day has ended. Refresh the room before saving a new note.';
  END IF;

  IF v_new_text IS DISTINCT FROM v_old_text THEN
    NEW.operational_note_date := CASE WHEN v_new_text = '' THEN NULL ELSE v_today END;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS aa_hc_preserve_workday_room_notes ON public.rooms;
CREATE TRIGGER aa_hc_preserve_workday_room_notes
BEFORE UPDATE OF notes ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_preserve_workday_room_notes();

REVOKE ALL ON FUNCTION public.hc_preserve_workday_room_notes() FROM PUBLIC;

-- This runs at every UTC minute. The date comparison means it performs no
-- clearing until Budapest-local midnight (correct in CET and CEST), and retries
-- safely if a cron tick was delayed. A row just created after midnight carries
-- today's date and cannot be deleted by the previous day's expiry.
CREATE OR REPLACE FUNCTION public.hc_expire_workday_room_notes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_cleared integer := 0;
BEGIN
  UPDATE public.rooms AS r
  SET notes = nullif(concat_ws(' ',
    CASE WHEN position('[COLLECT_EXTRA_TOWELS]' IN coalesce(r.notes, '')) > 0
      THEN '[COLLECT_EXTRA_TOWELS]' END,
    CASE WHEN position('[ROOM_CLEANING]' IN coalesce(r.notes, '')) > 0
      THEN '[ROOM_CLEANING]' END
  ), ''),
  operational_note_date = NULL
  WHERE r.operational_note_date < v_today
    AND public.room_note_history_text(r.notes) <> '';

  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RETURN v_cleared;
END;
$function$;

REVOKE ALL ON FUNCTION public.hc_expire_workday_room_notes() FROM PUBLIC;

-- Job executes in the DB, not in a browser or ChatGPT task. pg_cron is already
-- installed on the HotelCare Supabase project. Named scheduling replaces the
-- same job on a migration rerun; no hard-coded numeric job ID.
SELECT cron.schedule(
  'hotelcare-expire-daily-room-notes',
  '* * * * *',
  'SELECT public.hc_expire_workday_room_notes();'
);
