-- Issue #259 / parent #254: the shared property-area catalog must honor
-- Gozsdu's date-specific Laundryner exclusion at the DATABASE boundary.
-- This migration changes functions/triggers only; it never reassigns staff,
-- modifies an approved plan, or edits live housekeeping / PMS records.

CREATE OR REPLACE FUNCTION public.gozsdu_laundry_guard_catalog_area()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.hotel_id <> 'gozsdu-court' THEN
    RETURN NEW;
  END IF;
  -- This is the same per-person/date lock used by set_gozsdu_laundry_duty
  -- and the room/general/legacy-area assignment guard. It serializes
  -- concurrent duty and catalog-area assignment changes.
  PERFORM public.gozsdu_laundry_lock(NEW.assigned_to, NEW.plan_date);
  IF EXISTS (
    SELECT 1 FROM public.gozsdu_laundry_duties d
    WHERE d.organization_slug = NEW.organization_slug
      AND d.hotel_id = 'gozsdu-court'
      AND d.work_date = NEW.plan_date
      AND d.user_id = NEW.assigned_to
  ) THEN
    RAISE EXCEPTION 'This employee is Laundryner on %, and cannot receive public-area cleaning assignments', NEW.plan_date
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS gozsdu_laundry_guard_catalog_area ON public.next_day_housekeeping_public_area_assignments;
CREATE TRIGGER gozsdu_laundry_guard_catalog_area
BEFORE INSERT OR UPDATE OF assigned_to, plan_date, hotel_id, organization_slug
ON public.next_day_housekeeping_public_area_assignments
FOR EACH ROW EXECUTE FUNCTION public.gozsdu_laundry_guard_catalog_area();

-- Keep the existing authorization and safety rules intact. Add the missing
-- catalog-area conflict check; approved (but unreleased) schedules are still
-- editable only after conflicting cleaning work is explicitly reassigned.
CREATE OR REPLACE FUNCTION public.set_gozsdu_laundry_duty(
  p_user_id uuid, p_work_date date, p_enabled boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.profiles%rowtype;
  v_staff public.profiles%rowtype;
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO v_staff FROM public.profiles WHERE id = p_user_id;
  IF v_actor.id IS NULL
    OR v_actor.role::text NOT IN ('manager','housekeeping_manager','admin','top_management','top_management_manager')
    OR v_actor.assigned_hotel NOT IN ('gozsdu-court','Gozsdu Court Budapest')
    OR v_staff.id IS NULL
    OR v_staff.organization_slug IS DISTINCT FROM v_actor.organization_slug
    OR v_staff.assigned_hotel NOT IN ('gozsdu-court','Gozsdu Court Budapest')
    OR NOT (v_staff.role::text = 'housekeeping' OR coalesce(v_staff.acts_as_housekeeper,false))
    OR p_work_date IS NULL OR p_work_date < v_today OR p_work_date > v_today + 30
    OR p_enabled IS NULL
  THEN
    RAISE EXCEPTION 'Unauthorized or invalid Gozsdu Laundryner duty' USING ERRCODE = '42501';
  END IF;

  PERFORM public.gozsdu_laundry_lock(p_user_id, p_work_date);

  -- A released plan has materialized operational tasks; changing duties at
  -- that stage must use a separate controlled live-day workflow.
  IF EXISTS (
    SELECT 1 FROM public.next_day_housekeeping_plans p
    WHERE p.organization_slug = v_actor.organization_slug
      AND p.hotel_id = 'gozsdu-court'
      AND p.plan_date = p_work_date
      AND p.status IN ('releasing','released')
  ) THEN
    RAISE EXCEPTION 'Laundryner duty is locked after tomorrow plan release begins';
  END IF;

  IF p_enabled THEN
    IF EXISTS (
      SELECT 1 FROM public.room_assignments a
      JOIN public.rooms r ON r.id = a.room_id
      WHERE a.assigned_to = p_user_id AND a.assignment_date = p_work_date
        AND r.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    ) OR EXISTS (
      SELECT 1 FROM public.general_tasks t
      WHERE t.assigned_to = p_user_id AND t.assigned_date = p_work_date
        AND t.hotel IN ('gozsdu-court','Gozsdu Court Budapest') AND t.status <> 'cancelled'
    ) OR EXISTS (
      SELECT 1 FROM public.next_day_housekeeping_plan_items i
      JOIN public.next_day_housekeeping_plans p ON p.id = i.plan_id
      WHERE i.assigned_to = p_user_id AND p.plan_date = p_work_date
        AND p.hotel_id = 'gozsdu-court' AND p.organization_slug = v_actor.organization_slug
        AND p.status NOT IN ('cancelled','failed')
    ) OR EXISTS (
      SELECT 1 FROM public.next_day_housekeeping_plan_area_tasks a
      JOIN public.next_day_housekeeping_plans p ON p.id = a.plan_id
      WHERE a.assigned_to = p_user_id AND p.plan_date = p_work_date
        AND p.hotel_id = 'gozsdu-court' AND p.organization_slug = v_actor.organization_slug
        AND p.status NOT IN ('cancelled','failed')
    ) OR EXISTS (
      SELECT 1 FROM public.next_day_housekeeping_public_area_assignments a
      WHERE a.assigned_to = p_user_id AND a.plan_date = p_work_date
        AND a.hotel_id = 'gozsdu-court' AND a.organization_slug = v_actor.organization_slug
    ) THEN
      RAISE EXCEPTION 'Resolve existing cleaning, public-area, or room assignments before selecting Laundryner';
    END IF;
    INSERT INTO public.gozsdu_laundry_duties(organization_slug,hotel_id,work_date,user_id,assigned_by)
    VALUES(v_actor.organization_slug,'gozsdu-court',p_work_date,p_user_id,v_actor.id)
    ON CONFLICT(organization_slug,hotel_id,work_date,user_id) DO NOTHING;
  ELSE
    DELETE FROM public.gozsdu_laundry_duties
    WHERE organization_slug = v_actor.organization_slug
      AND hotel_id = 'gozsdu-court' AND work_date = p_work_date AND user_id = p_user_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.gozsdu_laundry_guard_catalog_area() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_gozsdu_laundry_duty(uuid,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_gozsdu_laundry_duty(uuid,date,boolean) TO authenticated;
