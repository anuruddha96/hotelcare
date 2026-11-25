-- An authenticated manager must be able to clear Hotel Memories' bed setup,
-- including on the same day it was set. Preserve all existing workday/PMS guards.
-- Other hotels are unaffected. No existing room data is changed.
CREATE OR REPLACE FUNCTION public.hc_memories_guard_workday_instructions()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_today date := (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date; v_old_text text := public.room_note_history_text(OLD.notes); v_new_text text := public.room_note_history_text(NEW.notes); v_pms_change boolean;
BEGIN
 IF lower(btrim(coalesce(OLD.hotel, ''))) <> 'hotel memories budapest' OR lower(btrim(coalesce(NEW.hotel, ''))) <> 'hotel memories budapest' THEN RETURN NEW; END IF;
 v_pms_change := (coalesce(NEW.pms_metadata, '{}'::jsonb) - 'inferredBedConfig' - 'managerBedSetupAfterCheckout') IS DISTINCT FROM (coalesce(OLD.pms_metadata, '{}'::jsonb) - 'inferredBedConfig' - 'managerBedSetupAfterCheckout');
 IF NEW.notes IS DISTINCT FROM OLD.notes THEN
  IF OLD.memories_manual_note_date = v_today AND v_old_text <> '' AND (v_new_text = '' OR v_pms_change) THEN
   NEW.notes := nullif(concat_ws(' ', CASE WHEN position('[COLLECT_EXTRA_TOWELS]' IN coalesce(NEW.notes, '')) > 0 THEN '[COLLECT_EXTRA_TOWELS]' END, CASE WHEN position('[ROOM_CLEANING]' IN coalesce(NEW.notes, '')) > 0 THEN '[ROOM_CLEANING]' END, v_old_text), '');
   NEW.memories_manual_note_date := OLD.memories_manual_note_date;
  ELSIF auth.uid() IS NOT NULL AND NOT v_pms_change AND v_new_text <> '' THEN NEW.memories_manual_note_date := v_today; END IF;
 END IF;
 IF NEW.bed_configuration IS DISTINCT FROM OLD.bed_configuration THEN
  -- A direct authenticated manager edit (including NULL/clear) is intentional.
  -- PMS/service refreshes still cannot erase today's manually set instruction.
  IF auth.uid() IS NOT NULL AND NOT v_pms_change THEN
    NEW.memories_manual_bed_date := CASE
      WHEN nullif(btrim(coalesce(NEW.bed_configuration, '')), '') IS NULL THEN NULL
      ELSE v_today
    END;
  ELSIF OLD.memories_manual_bed_date = v_today
    AND nullif(btrim(coalesce(OLD.bed_configuration, '')), '') IS NOT NULL
    AND (nullif(btrim(coalesce(NEW.bed_configuration, '')), '') IS NULL OR v_pms_change)
  THEN
    NEW.bed_configuration := OLD.bed_configuration;
    NEW.memories_manual_bed_date := OLD.memories_manual_bed_date;
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;
