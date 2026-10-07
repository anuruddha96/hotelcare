-- A room note is not a permanent room attribute. Mika checkout work must not
-- inherit instructions written for a previous day's daily service or guest.
-- Scope deliberately limited to RD Hotels / Mika; retain room-note history.

CREATE OR REPLACE FUNCTION public.hc_mika_note_is_stale_for_checkout(
  p_room_id uuid,
  p_notes text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT
    NULLIF(public.room_note_history_text(p_notes), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.housekeeping_notes h
      WHERE h.room_id = p_room_id
        AND h.note_type = 'room_note_history'
        AND h.content = public.room_note_history_text(p_notes)
        AND h.created_at < (((now() AT TIME ZONE 'Europe/Budapest')::date) AT TIME ZONE 'Europe/Budapest')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.housekeeping_notes h
      WHERE h.room_id = p_room_id
        AND h.note_type = 'room_note_history'
        AND h.created_at >= (((now() AT TIME ZONE 'Europe/Budapest')::date) AT TIME ZONE 'Europe/Budapest')
    );
$fn$;

-- Preserve operational markers separately from the expired free-text note.
CREATE OR REPLACE FUNCTION public.hc_mika_note_service_markers(p_notes text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT NULLIF(concat_ws(' ',
    CASE WHEN position('[COLLECT_EXTRA_TOWELS]' in coalesce(p_notes,'')) > 0 THEN '[COLLECT_EXTRA_TOWELS]' END,
    CASE WHEN position('[ROOM_CLEANING]' in coalesce(p_notes,'')) > 0 THEN '[ROOM_CLEANING]' END
  ), '');
$fn$;

CREATE OR REPLACE FUNCTION public.hc_mika_expire_checkout_note_on_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.organization_slug IS DISTINCT FROM 'rdhotels'
    OR NEW.hotel IS DISTINCT FROM 'mika-downtown'
    OR NEW.is_checkout_room IS DISTINCT FROM true
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NOT public.hc_mika_note_is_stale_for_checkout(NEW.id, NEW.notes)
  THEN
    RETURN NEW;
  END IF;

  -- Do not overwrite a newly entered current-day assignment instruction.
  IF EXISTS (
    SELECT 1 FROM public.room_assignments a
    WHERE a.room_id = NEW.id
      AND a.assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
      AND a.manager_instruction_updated_at >= (((now() AT TIME ZONE 'Europe/Budapest')::date) AT TIME ZONE 'Europe/Budapest')
      AND nullif(btrim(a.manager_instruction_text), '') IS NOT NULL
      AND a.manager_instruction_text NOT IN (
        'Room instructions updated', 'Towel change required', 'Linen change required',
        'Towel change required · Linen change required'
      )
  ) THEN
    RETURN NEW;
  END IF;

  NEW.notes := public.hc_mika_note_service_markers(OLD.notes);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_hc_mika_expire_checkout_note ON public.rooms;
CREATE TRIGGER trg_hc_mika_expire_checkout_note
BEFORE UPDATE ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.hc_mika_expire_checkout_note_on_update();

CREATE OR REPLACE FUNCTION public.hc_expire_mika_stale_checkout_notes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_expired integer := 0;
BEGIN
  UPDATE public.rooms r
  SET notes = public.hc_mika_note_service_markers(r.notes)
  WHERE r.organization_slug = 'rdhotels'
    AND r.hotel = 'mika-downtown'
    AND r.is_checkout_room IS TRUE
    AND public.hc_mika_note_is_stale_for_checkout(r.id, r.notes)
    AND NOT EXISTS (
      SELECT 1 FROM public.room_assignments a
      WHERE a.room_id = r.id
        AND a.assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
        AND a.manager_instruction_updated_at >= (((now() AT TIME ZONE 'Europe/Budapest')::date) AT TIME ZONE 'Europe/Budapest')
        AND nullif(btrim(a.manager_instruction_text), '') IS NOT NULL
        AND a.manager_instruction_text NOT IN (
          'Room instructions updated', 'Towel change required', 'Linen change required',
          'Towel change required · Linen change required'
        )
    );
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$fn$;

REVOKE ALL ON FUNCTION public.hc_expire_mika_stale_checkout_notes() FROM PUBLIC, anon, authenticated;

-- pg_cron runs in UTC: 01:05 UTC is safely after Budapest midnight year-round.
DO $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'hotelcare-mika-expire-stale-checkout-notes'
  ) THEN
    PERFORM cron.schedule(
      'hotelcare-mika-expire-stale-checkout-notes',
      '5 1 * * *',
      'select public.hc_expire_mika_stale_checkout_notes();'
    );
  END IF;
END;
$fn$;
