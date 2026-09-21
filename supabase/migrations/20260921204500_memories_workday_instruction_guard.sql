-- Hotel Memories Budapest only: manager instructions belong to the local working
-- date. PMS synchronization and stale room editors must not erase them mid-day.
-- Historical assignments, note history, room mappings, and other hotels stay intact.
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS memories_manual_note_date date;
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS memories_manual_bed_date date;

-- Existing notes/configurations are intentionally NOT assumed to be today's:
-- previous-guest instructions must not be revived by a migration/backfill.
CREATE OR REPLACE FUNCTION public.hc_memories_guard_workday_instructions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_old_text text := public.room_note_history_text(OLD.notes);
  v_new_text text := public.room_note_history_text(NEW.notes);
  v_pms_change boolean;
BEGIN
  IF lower(btrim(coalesce(OLD.hotel, ''))) <> 'hotel memories budapest'
     OR lower(btrim(coalesce(NEW.hotel, ''))) <> 'hotel memories budapest' THEN
    RETURN NEW;
  END IF;

  -- Inferred-bed metadata is removed by the existing manual-bed trigger. That
  -- bookkeeping alone is not a PMS refresh; reservation/roster changes are.
  v_pms_change := (
    coalesce(NEW.pms_metadata, '{}'::jsonb) - 'inferredBedConfig' - 'managerBedSetupAfterCheckout'
  ) IS DISTINCT FROM (
    coalesce(OLD.pms_metadata, '{}'::jsonb) - 'inferredBedConfig' - 'managerBedSetupAfterCheckout'
  );

  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    -- Honor today's manager-authored text even if a PMS sync or a stale editor
    -- sends NULL. Service tokens remain independently editable.
    IF OLD.memories_manual_note_date = v_today AND v_old_text <> ''
       AND (v_new_text = '' OR v_pms_change) THEN
      NEW.notes := nullif(concat_ws(' ',
        CASE WHEN position('[COLLECT_EXTRA_TOWELS]' IN coalesce(NEW.notes, '')) > 0
          THEN '[COLLECT_EXTRA_TOWELS]' END,
        CASE WHEN position('[ROOM_CLEANING]' IN coalesce(NEW.notes, '')) > 0
          THEN '[ROOM_CLEANING]' END,
        v_old_text
      ), '');
      NEW.memories_manual_note_date := OLD.memories_manual_note_date;
    ELSIF auth.uid() IS NOT NULL AND NOT v_pms_change AND v_new_text <> '' THEN
      NEW.memories_manual_note_date := v_today;
    END IF;
  END IF;

  IF NEW.bed_configuration IS DISTINCT FROM OLD.bed_configuration THEN
    IF OLD.memories_manual_bed_date = v_today
       AND nullif(btrim(coalesce(OLD.bed_configuration, '')), '') IS NOT NULL
       AND (nullif(btrim(coalesce(NEW.bed_configuration, '')), '') IS NULL OR v_pms_change) THEN
      NEW.bed_configuration := OLD.bed_configuration;
      NEW.memories_manual_bed_date := OLD.memories_manual_bed_date;
    ELSIF auth.uid() IS NOT NULL AND NOT v_pms_change
       AND nullif(btrim(coalesce(NEW.bed_configuration, '')), '') IS NOT NULL THEN
      NEW.memories_manual_bed_date := v_today;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzz_hc_memories_workday_instructions ON public.rooms;
CREATE TRIGGER zzzzz_hc_memories_workday_instructions
BEFORE UPDATE OF notes, bed_configuration, pms_metadata ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_memories_guard_workday_instructions();
REVOKE ALL ON FUNCTION public.hc_memories_guard_workday_instructions() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.hc_expire_memories_workday_instructions()
RETURNS TABLE(expired_notes integer, expired_beds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date;
  v_notes integer := 0;
  v_beds integer := 0;
BEGIN
  UPDATE public.rooms AS r
  SET notes = nullif(concat_ws(' ',
      CASE WHEN position('[COLLECT_EXTRA_TOWELS]' IN coalesce(r.notes, '')) > 0
        THEN '[COLLECT_EXTRA_TOWELS]' END,
      CASE WHEN position('[ROOM_CLEANING]' IN coalesce(r.notes, '')) > 0
        THEN '[ROOM_CLEANING]' END
    ), ''),
    memories_manual_note_date = NULL
  WHERE lower(btrim(coalesce(r.hotel, ''))) = 'hotel memories budapest'
    AND r.memories_manual_note_date < v_today;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  UPDATE public.rooms AS r
  SET bed_configuration = NULL,
      memories_manual_bed_date = NULL
  WHERE lower(btrim(coalesce(r.hotel, ''))) = 'hotel memories budapest'
    AND r.memories_manual_bed_date < v_today;
  GET DIAGNOSTICS v_beds = ROW_COUNT;

  RETURN QUERY SELECT v_notes, v_beds;
END;
$function$;
REVOKE ALL ON FUNCTION public.hc_expire_memories_workday_instructions() FROM PUBLIC;

-- Every UTC minute: a Budapest-local date comparison handles CET/CEST and
-- delayed cron ticks. The first tick after 00:00 expires only prior-day entries.
SELECT cron.schedule(
  'hotelcare-expire-memories-workday-instructions',
  '* * * * *',
  'SELECT * FROM public.hc_expire_memories_workday_instructions();'
);
