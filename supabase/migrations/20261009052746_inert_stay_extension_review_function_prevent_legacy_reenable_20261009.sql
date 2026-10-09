-- Hard stop: an older 2026-10-08 migration might be applied later and
-- recreate the historical detector trigger. Its function must remain inert.
DROP TRIGGER IF EXISTS zzz_hc_detect_stay_extension ON public.rooms;

CREATE OR REPLACE FUNCTION public.hc_record_stay_extension_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Speculative review generation is permanently retired.
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.hc_record_stay_extension_review()
IS 'Retired 2026-10-09: no auto-inferred stay-extension reviews; use verified PMS reservations and explicit manual moves.';

UPDATE public.housekeeping_stay_extension_reviews
SET status = 'resolved',
    resolution_note = coalesce(
      nullif(btrim(resolution_note), ''),
      'System: retired speculative stay-extension review; no manager action required.'
    ),
    updated_at = now()
WHERE status <> 'resolved';
