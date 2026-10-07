-- A transfer consisting exclusively of live work might not update plan children.
-- Guard the final duty insert as well, so a plan that is already validated for
-- release cannot quietly acquire a new Laundryner with an outdated roster.
CREATE OR REPLACE FUNCTION public.gozsdu_laundry_guard_duty_release_validation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.next_day_housekeeping_plans%rowtype;
BEGIN
  IF NEW.hotel_id <> 'gozsdu-court' THEN RETURN NEW; END IF;
  SELECT * INTO v_plan FROM public.next_day_housekeeping_plans p
  WHERE p.organization_slug = NEW.organization_slug
    AND p.hotel_id = NEW.hotel_id AND p.plan_date = NEW.work_date FOR UPDATE;
  IF v_plan.id IS NOT NULL AND (
    v_plan.status IN ('releasing','released')
    OR v_plan.release_attempted_at IS NOT NULL
    OR (v_plan.status = 'approved' AND (
      v_plan.release_revalidation_status NOT IN ('pending','failed')
      OR v_plan.release_revalidated_at IS NOT NULL
      OR (v_plan.auto_release AND v_plan.scheduled_release_at <= now() + interval '15 minutes')
    ))
  ) THEN
    RAISE EXCEPTION 'Next-day plan release validation has started; Laundryner roster changes are locked';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS gozsdu_laundry_guard_duty_release_validation ON public.gozsdu_laundry_duties;
CREATE TRIGGER gozsdu_laundry_guard_duty_release_validation
BEFORE INSERT OR UPDATE OF user_id, work_date, organization_slug, hotel_id
ON public.gozsdu_laundry_duties
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_laundry_guard_duty_release_validation();
REVOKE ALL ON FUNCTION public.gozsdu_laundry_guard_duty_release_validation() FROM PUBLIC;
