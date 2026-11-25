-- Manager-entered bed setup instructions must override PMS-inferred bed setup
-- on the housekeeper card. The existing UI falls back to rooms.bed_configuration
-- whenever pms_metadata.inferredBedConfig is absent, so remove only that inferred
-- key while a manual bed configuration is present. Other PMS metadata is preserved.

CREATE OR REPLACE FUNCTION public.prefer_manual_bed_configuration()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.bed_configuration IS NOT NULL AND btrim(NEW.bed_configuration) = '' THEN
    NEW.bed_configuration := NULL;
  END IF;

  IF NEW.bed_configuration IS NOT NULL THEN
    NEW.pms_metadata := coalesce(NEW.pms_metadata, '{}'::jsonb) - 'inferredBedConfig';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prefer_manual_bed_configuration ON public.rooms;
CREATE TRIGGER trg_prefer_manual_bed_configuration
BEFORE INSERT OR UPDATE OF bed_configuration, pms_metadata ON public.rooms
FOR EACH ROW
EXECUTE FUNCTION public.prefer_manual_bed_configuration();

-- Align existing manual instructions with the same precedence rule without
-- changing any other PMS metadata or room fields.
UPDATE public.rooms
SET pms_metadata = coalesce(pms_metadata, '{}'::jsonb) - 'inferredBedConfig'
WHERE bed_configuration IS NOT NULL
  AND btrim(bed_configuration) <> ''
  AND coalesce(pms_metadata, '{}'::jsonb) ? 'inferredBedConfig';
