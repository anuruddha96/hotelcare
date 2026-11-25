-- Hotel Memories Budapest only: stop generating former-guest bed-setup room notes.
-- Does not change manual notes, bed_configuration lifecycle or other hotels.
-- Safe to run after the live emergency fix: the generator amendment is idempotent.
DO $body$
DECLARE
  v_definition text;
  v_patched text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='hotelcare_protect_daily_room_manual_setup'
    AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected HotelCare bed-setup lifecycle trigger function missing';
  END IF;

  IF position('new.notes := concat_ws' IN v_definition) > 0 THEN
    v_patched := regexp_replace(
      v_definition,
      '^ +new[.]notes := concat_ws[(][^\r\n]*previous_note[)];$',
      '      -- Preserve prior bed setup only in metadata; do not create room notes.',
      'm'
    );
    IF v_patched = v_definition OR position('new.notes := concat_ws' IN v_patched) <> 0 THEN
      RAISE EXCEPTION 'Could not safely isolate generated-note write';
    END IF;
    EXECUTE v_patched;
  ELSIF position('Preserve prior bed setup only in metadata' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'HotelCare bed-setup lifecycle differs: review before altering notes';
  END IF;
END;
$body$;

-- Final safeguard. Existing HMB workday/manual-note guards run earlier.
CREATE OR REPLACE FUNCTION public.hc_memories_strip_proven_generated_bed_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_auto text;
  v_source text;
BEGIN
  IF lower(btrim(coalesce(NEW.hotel,''))) NOT IN
    ('hotel memories budapest', 'memories budapest', 'memories-budapest') THEN
    RETURN NEW;
  END IF;

  v_auto := nullif(btrim(coalesce(NEW.pms_metadata #>> '{previousGuestBedSetup,note}', '')), '');
  v_source := nullif(btrim(coalesce(NEW.pms_metadata #>> '{previousGuestBedSetup,source}', '')), '');
  IF v_auto IS NOT NULL
    AND coalesce(v_source, 'checkout_reset') = 'checkout_reset'
    AND v_auto ~* '^Previous guest bed setup: .+ (—|–|-) reset to standard room setup[.]$'
    AND position(v_auto IN coalesce(NEW.notes, '')) > 0 THEN
    NEW.notes := nullif(btrim(
      regexp_replace(replace(coalesce(NEW.notes,''), v_auto, ''),
        E'\n[ \t]*\n+', E'\n', 'g'),
      E' \n\r\t'), '');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzzzzzzzzzzzzzzz_hc_memories_strip_auto_note ON public.rooms;
CREATE TRIGGER zzzzzzzzzzzzzzzz_hc_memories_strip_auto_note
BEFORE INSERT OR UPDATE OF notes, pms_metadata, bed_configuration ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.hc_memories_strip_proven_generated_bed_note();

-- Clean only the exact metadata-proven generated text in HMB.
-- Text such as 'Single Beds', manual special instructions, flags and note history survive.
UPDATE public.rooms r
SET notes = nullif(btrim(
  regexp_replace(
    replace(coalesce(r.notes,''), r.pms_metadata #>> '{previousGuestBedSetup,note}', ''),
    E'\n[ \t]*\n+', E'\n', 'g'),
  E' \n\r\t'), '')
WHERE lower(btrim(coalesce(r.hotel,''))) IN
  ('hotel memories budapest', 'memories budapest', 'memories-budapest')
  AND coalesce(nullif(btrim(r.pms_metadata #>> '{previousGuestBedSetup,source}'), ''), 'checkout_reset') = 'checkout_reset'
  AND coalesce(r.pms_metadata #>> '{previousGuestBedSetup,note}', '')
    ~* '^Previous guest bed setup: .+ (—|–|-) reset to standard room setup[.]$'
  AND position((r.pms_metadata #>> '{previousGuestBedSetup,note}') IN coalesce(r.notes,'')) > 0;
