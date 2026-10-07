-- A transfer might have no planned room/area rows (only live tasks). It
-- still updates the plan staff roster: cover that path with the same guard.
DROP TRIGGER IF EXISTS gozsdu_laundry_staff_revalidation_guard ON public.next_day_housekeeping_plan_staff;
CREATE TRIGGER gozsdu_laundry_staff_revalidation_guard
BEFORE UPDATE OF selected ON public.next_day_housekeeping_plan_staff
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_laundry_transfer_revalidation_guard();
