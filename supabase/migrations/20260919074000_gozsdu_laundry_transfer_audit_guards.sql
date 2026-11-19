-- Follow-on safety refinement for #260. A manager may transfer a mapped-area
-- task originally created by another manager, but must NEVER rewrite creator.
CREATE OR REPLACE FUNCTION public.validate_next_day_housekeeping_area_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_section_hotel text;
  v_atomic_transfer boolean;
BEGIN
  SELECT * INTO v_plan FROM public.next_day_housekeeping_plans WHERE id = new.plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Next-day housekeeping plan does not exist'; END IF;
  v_atomic_transfer := tg_op = 'UPDATE' AND v_plan.status = 'approved'
    AND v_plan.hotel_id = 'gozsdu-court'
    AND current_setting('hotelcare.laundry_transfer_plan_id', true) = v_plan.id::text
    AND current_setting('hotelcare.laundry_transfer_actor', true) = auth.uid()::text;
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF (now() AT TIME ZONE 'Europe/Budapest')::time < time '12:00' THEN
      RAISE EXCEPTION 'Tomorrow housekeeping planning is available after 12:00 Europe/Budapest';
    END IF;
    IF v_plan.status <> 'draft' AND NOT v_atomic_transfer THEN
      RAISE EXCEPTION 'Tomorrow public-area work can only be edited while the plan is a draft';
    END IF;
    IF NOT public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) THEN
      RAISE EXCEPTION 'Not authorized to manage this tomorrow housekeeping plan';
    END IF;
    IF new.created_by IS DISTINCT FROM auth.uid() AND NOT (
      v_atomic_transfer AND new.created_by IS NOT DISTINCT FROM old.created_by
    ) THEN
      RAISE EXCEPTION 'created_by must match the signed-in user';
    END IF;
  END IF;
  IF length(trim(coalesce(new.task_key, ''))) = 0 OR length(new.task_key) > 160 THEN
    RAISE EXCEPTION 'Invalid public-area task key';
  END IF;
  IF length(trim(coalesce(new.task_name, ''))) = 0 OR length(new.task_name) > 240 THEN
    RAISE EXCEPTION 'Invalid public-area task name';
  END IF;
  IF length(trim(coalesce(new.task_type, ''))) = 0 OR length(new.task_type) > 120 THEN
    RAISE EXCEPTION 'Invalid public-area task type';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.next_day_housekeeping_plan_staff s
    WHERE s.plan_id = new.plan_id AND s.user_id = new.assigned_to AND s.selected = true) THEN
    RAISE EXCEPTION 'Public-area assignee must be selected for the tomorrow plan';
  END IF;
  IF new.section_task_id IS NOT NULL THEN
    SELECT hs.hotel_name INTO v_section_hotel
    FROM public.hotel_housekeeping_section_tasks ht
    JOIN public.hotel_housekeeping_sections hs ON hs.id = ht.section_id
    WHERE ht.id = new.section_task_id AND (new.section_id IS NULL OR new.section_id = ht.section_id);
    IF v_section_hotel IS NULL THEN RAISE EXCEPTION 'Mapped public-area task is not valid'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.hotel_configurations hc
      WHERE hc.hotel_id = v_plan.hotel_id
        AND lower(trim(hc.hotel_name)) = lower(trim(v_section_hotel)))
      AND lower(trim(v_plan.hotel_id)) <> lower(trim(v_section_hotel)) THEN
      RAISE EXCEPTION 'Mapped public-area task belongs to another hotel';
    END IF;
  END IF;
  new.updated_at := now();
  RETURN new;
END;
$function$;

-- Release revalidation may already have certified a previous owner list.
-- Refuse owner transfers in that state rather than silently using stale
-- morning validation. A fresh approval is required through the normal flow.
CREATE OR REPLACE FUNCTION public.gozsdu_laundry_transfer_revalidation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_plan public.next_day_housekeeping_plans%rowtype;
BEGIN
  IF tg_op <> 'UPDATE' OR coalesce(current_setting('hotelcare.laundry_transfer_actor',true),'') = '' THEN
    RETURN coalesce(new,old);
  END IF;
  IF tg_table_name = 'next_day_housekeeping_public_area_assignments' THEN
    SELECT * INTO v_plan FROM public.next_day_housekeeping_plans p
    WHERE p.organization_slug=new.organization_slug AND p.hotel_id=new.hotel_id
      AND p.plan_date=new.plan_date;
  ELSE
    v_plan_id := new.plan_id;
    SELECT * INTO v_plan FROM public.next_day_housekeeping_plans WHERE id=v_plan_id;
  END IF;
  IF v_plan.id IS NOT NULL AND v_plan.status='approved'
    AND (v_plan.release_revalidation_status NOT IN ('pending','failed')
      OR v_plan.release_revalidated_at IS NOT NULL
      OR v_plan.release_attempted_at IS NOT NULL
      OR (v_plan.auto_release AND v_plan.scheduled_release_at <= now() + interval '15 minutes')) THEN
    RAISE EXCEPTION 'Plan release validation has begun. Reopen and approve a fresh schedule before transferring Laundryner work';
  END IF;
  RETURN coalesce(new,old);
END;
$function$;

DROP TRIGGER IF EXISTS gozsdu_laundry_plan_revalidation_guard ON public.next_day_housekeeping_plan_items;
CREATE TRIGGER gozsdu_laundry_plan_revalidation_guard
BEFORE UPDATE OF assigned_to ON public.next_day_housekeeping_plan_items
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_laundry_transfer_revalidation_guard();
DROP TRIGGER IF EXISTS gozsdu_laundry_area_revalidation_guard ON public.next_day_housekeeping_plan_area_tasks;
CREATE TRIGGER gozsdu_laundry_area_revalidation_guard
BEFORE UPDATE OF assigned_to ON public.next_day_housekeeping_plan_area_tasks
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_laundry_transfer_revalidation_guard();
DROP TRIGGER IF EXISTS gozsdu_laundry_catalog_revalidation_guard ON public.next_day_housekeeping_public_area_assignments;
CREATE TRIGGER gozsdu_laundry_catalog_revalidation_guard
BEFORE UPDATE OF assigned_to ON public.next_day_housekeeping_public_area_assignments
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_laundry_transfer_revalidation_guard();

REVOKE ALL ON FUNCTION public.gozsdu_laundry_transfer_revalidation_guard() FROM PUBLIC;
