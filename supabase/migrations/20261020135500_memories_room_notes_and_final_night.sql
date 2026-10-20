-- HMB ONLY: do not create a former guest's bed setup as a housekeeping note.
-- The preceding lifecycle trigger continues to manage bed_configuration and
-- its audit metadata. This later-alphabetical guard removes ONLY the exact
-- generator output proven by previousGuestBedSetup.note. It never touches
-- general hand-entered manager notes, other hotels, or note-history rows.
CREATE OR REPLACE FUNCTION public.hc_memories_hide_generated_room_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_auto text;
BEGIN
  IF lower(btrim(coalesce(NEW.hotel,''))) NOT IN
    ('hotel memories budapest', 'memories budapest', 'memories-budapest') THEN
    RETURN NEW;
  END IF;
  v_auto := nullif(btrim(coalesce(NEW.pms_metadata #>> '{previousGuestBedSetup,note}', '')), '');
  IF v_auto IS NOT NULL
     AND v_auto ~* '^Previous guest bed setup: .+ (—|–|-) reset to standard room setup\.$'
     AND position(v_auto IN coalesce(NEW.notes,'')) > 0 THEN
    NEW.notes := nullif(btrim(
      regexp_replace(replace(coalesce(NEW.notes,''),v_auto,''), E'\n[ \t]*\n+', E'\n', 'g'),
      E' \n\r\t'), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzzz_hc_memories_generated_note_guard ON public.rooms;
CREATE TRIGGER zzzz_hc_memories_generated_note_guard
BEFORE INSERT OR UPDATE OF notes,pms_metadata,bed_configuration
ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_memories_hide_generated_room_note();

-- Idempotent restricted backfill. Uses the *recorded generated string* rather
-- than a broad regex so the manager's October 20 and historical manual notes
-- survive. The room note history remains untouched.
UPDATE public.rooms r
SET notes = nullif(btrim(regexp_replace(
  replace(coalesce(r.notes,''), r.pms_metadata #>> '{previousGuestBedSetup,note}', ''),
  E'\n[ \t]*\n+', E'\n', 'g'
), E' \n\r\t'), '')
WHERE lower(btrim(coalesce(r.hotel,''))) IN
  ('hotel memories budapest','memories budapest','memories-budapest')
  AND coalesce(r.pms_metadata #>> '{previousGuestBedSetup,note}','')
     ~* '^Previous guest bed setup: .+ (—|–|-) reset to standard room setup\.$'
  AND position((r.pms_metadata #>> '{previousGuestBedSetup,note}') IN coalesce(r.notes,'')) > 0;

-- The previous policy required departureDate to be populated. HMB's Previo
-- payload also carries continuousStay or same-day currentNight/totalNights.
-- Other hotels retain EXACTLY the previous departureDate-only behavior.
CREATE OR REPLACE FUNCTION public.hc_carry_final_night_towel_only(
 p_hotel text, p_pms_metadata jsonb, p_business_date date
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $body$
DECLARE
 v_departure date;
 v_hotel_settings jsonb;
 v_policy jsonb;
 v_enabled text;
 v_memories boolean := lower(btrim(coalesce(p_hotel,''))) IN
   ('hotel memories budapest','memories budapest','memories-budapest');
 v_last_night boolean := false;
 v_current integer;
 v_total integer;
BEGIN
 IF p_business_date IS NULL THEN RETURN false; END IF;
 BEGIN
   v_departure := nullif(btrim(coalesce(p_pms_metadata->>'departureDate',
     CASE WHEN v_memories THEN p_pms_metadata #>> '{continuousStay,departureDate}' END,'')), '')::date;
 EXCEPTION WHEN OTHERS THEN v_departure := NULL;
 END;
 v_last_night := (v_departure = p_business_date + 1);
 IF v_memories AND v_departure IS NULL
    AND p_pms_metadata->>'pmsSyncDate' = p_business_date::text THEN
   BEGIN
     -- Preserve the whole in-house stay; continuousStay can describe only
     -- the latest extension segment (e.g. 2/2 within a 2/6 total stay).
     v_current := coalesce(nullif(p_pms_metadata->>'currentNight','')::integer,
                           nullif(p_pms_metadata #>> '{continuousStay,currentNight}','')::integer);
     v_total := coalesce(nullif(p_pms_metadata->>'totalNights','')::integer,
                         nullif(p_pms_metadata #>> '{continuousStay,totalNights}','')::integer);
     v_last_night := v_total > 0 AND v_current = v_total;
   EXCEPTION WHEN OTHERS THEN v_last_night := false;
   END;
 END IF;
 IF NOT coalesce(v_last_night,false) THEN RETURN false; END IF;
 SELECT h.settings INTO v_hotel_settings
 FROM public.hotel_configurations h
 WHERE h.is_active AND (
   lower(btrim(h.hotel_id)) = lower(btrim(coalesce(p_hotel,'')))
   OR lower(btrim(h.hotel_name)) = lower(btrim(coalesce(p_hotel,'')))
   OR (h.hotel_id='memories-budapest' AND v_memories)
 ) LIMIT 1;
 v_policy := CASE WHEN v_memories THEN v_hotel_settings->'memories_service_cycle'
   ELSE v_hotel_settings->'housekeeping_service_cycle' END;
 v_enabled := lower(btrim(coalesce(v_policy->>'final_night_towel_only','true')));
 RETURN v_enabled IN ('true','t','yes','1');
END;
$body$;
