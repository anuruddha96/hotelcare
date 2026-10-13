-- Stop reporting completed/cleaned tasks as outstanding.  DND and
-- guest-declined closures intentionally retain their unresolved carry.
CREATE OR REPLACE FUNCTION public.hc_retire_cleaned_housekeeping_carry()
RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public'
AS $body$
DECLARE
  v_carry jsonb;
BEGIN
  IF lower(btrim(coalesce(NEW.service_result,''))) <> 'cleaned' THEN
    RETURN NEW;
  END IF;
  v_carry := coalesce(NEW.previous_day_context,'{}'::jsonb)->'carry_forward';
  IF v_carry IS NULL OR v_carry->>'active' <> 'true' THEN
    RETURN NEW;
  END IF;
  NEW.previous_day_context := jsonb_set(
    coalesce(NEW.previous_day_context,'{}'::jsonb)-'carry_forward',
    '{resolved_carry_forward}',
    v_carry || jsonb_build_object('resolved_at',statement_timestamp(),'resolution','cleaned'),
    true
  );
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS zz_hc_retire_cleaned_housekeeping_carry ON public.room_assignments;
CREATE TRIGGER zz_hc_retire_cleaned_housekeeping_carry
BEFORE INSERT OR UPDATE OF service_result, status, previous_day_context
ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.hc_retire_cleaned_housekeeping_carry();

-- Repair only today's already-cleaned carry contexts. Older operational history
-- remains untouched, and the manager/housekeeper client also suppresses stale
-- active JSON whenever a completed task records service_result='cleaned'.
UPDATE public.room_assignments a
SET previous_day_context = jsonb_set(
  coalesce(a.previous_day_context,'{}'::jsonb)-'carry_forward',
  '{resolved_carry_forward}',
  (a.previous_day_context->'carry_forward')
   || jsonb_build_object('resolved_at',statement_timestamp(),'resolution','cleaned'),
  true
)
WHERE a.assignment_date=(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date
  AND a.service_result='cleaned'
  AND a.previous_day_context#>>'{carry_forward,active}'='true';
