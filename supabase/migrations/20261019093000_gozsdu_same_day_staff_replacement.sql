-- Gozsdu: permit a controlled same-day replacement after the overnight plan is released.
-- The approved/released plan is immutable history. Only unstarted operational tasks move.
CREATE TABLE IF NOT EXISTS public.housekeeping_same_day_staff_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.next_day_housekeeping_plans(id),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  work_date date NOT NULL,
  from_staff_id uuid NOT NULL REFERENCES public.profiles(id),
  to_staff_id uuid NOT NULL REFERENCES public.profiles(id),
  room_assignment_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  area_task_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  skipped_rooms integer NOT NULL DEFAULT 0,
  skipped_areas integer NOT NULL DEFAULT 0,
  replaced_by uuid NOT NULL REFERENCES public.profiles(id),
  replaced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distinct_same_day_replacement_staff CHECK (from_staff_id <> to_staff_id)
);
ALTER TABLE public.housekeeping_same_day_staff_replacements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Managers can review same-day staff replacements"
  ON public.housekeeping_same_day_staff_replacements;
CREATE POLICY "Managers can review same-day staff replacements"
  ON public.housekeeping_same_day_staff_replacements FOR SELECT TO authenticated
  USING (public.can_manage_next_day_housekeeping_plan(organization_slug, hotel_id));
REVOKE ALL ON public.housekeeping_same_day_staff_replacements FROM anon, authenticated;
GRANT SELECT ON public.housekeeping_same_day_staff_replacements TO authenticated;

CREATE OR REPLACE FUNCTION public.replace_released_housekeeping_staff(
  p_plan_id uuid,
  p_from_staff_id uuid,
  p_to_staff_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_plan public.next_day_housekeeping_plans%ROWTYPE;
  v_room_ids uuid[] := '{}'::uuid[];
  v_area_ids uuid[] := '{}'::uuid[];
  v_planned_rooms integer := 0;
  v_planned_areas integer := 0;
  v_moved_rooms integer := 0;
  v_moved_areas integer := 0;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR p_from_staff_id IS NULL OR p_to_staff_id IS NULL
     OR p_from_staff_id = p_to_staff_id THEN
    RAISE EXCEPTION 'Select two different staff members while signed in';
  END IF;

  SELECT * INTO v_plan
    FROM public.next_day_housekeeping_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR v_plan.status <> 'released'
    OR v_plan.hotel_id <> 'gozsdu-court' OR v_plan.organization_slug <> 'rdhotels'
    OR v_plan.plan_date <> (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Only today''s released Gozsdu schedule can be amended';
  END IF;

  IF NOT public.can_manage_next_day_housekeeping_plan(
    v_plan.organization_slug, v_plan.hotel_id
  ) THEN
    RAISE EXCEPTION 'You do not have permission to change this hotel schedule';
  END IF;

  IF NOT public.next_day_housekeeping_staff_matches_hotel(v_plan.id, p_to_staff_id) THEN
    RAISE EXCEPTION 'Replacement must be an active housekeeper assigned to this hotel';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.gozsdu_laundry_duties d
    WHERE d.organization_slug = v_plan.organization_slug
      AND d.hotel_id = v_plan.hotel_id
      AND d.work_date = v_plan.plan_date
      AND d.user_id = p_to_staff_id
  ) THEN
    RAISE EXCEPTION 'Selected replacement is on Laundryner duty today';
  END IF;

  SELECT count(*) INTO v_planned_rooms
    FROM public.next_day_housekeeping_plan_items
    WHERE plan_id = v_plan.id AND assigned_to = p_from_staff_id;
  SELECT count(*) INTO v_planned_areas
    FROM public.next_day_housekeeping_plan_area_tasks
    WHERE plan_id = v_plan.id AND assigned_to = p_from_staff_id;

  IF v_planned_rooms + v_planned_areas = 0 THEN
    RAISE EXCEPTION 'The departing staff member has no tasks in this saved plan';
  END IF;

  -- Matching original room ids and assignee prevents moving new or unrelated work.
  -- Lock/update only unstarted tasks; concurrent starts are rechecked by UPDATE.
  WITH moved AS (
    UPDATE public.room_assignments a
      SET assigned_to = p_to_staff_id, assigned_by = v_actor
    FROM public.next_day_housekeeping_plan_items i
    JOIN public.rooms r ON r.id = i.room_id
    WHERE i.plan_id = v_plan.id
      AND i.assigned_to = p_from_staff_id
      AND r.organization_slug = v_plan.organization_slug
      AND r.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
      AND a.room_id = i.room_id
      AND a.assignment_date = v_plan.plan_date
      AND a.organization_slug = v_plan.organization_slug
      AND a.assigned_to = p_from_staff_id
      AND a.status::text = 'assigned'
      AND a.started_at IS NULL
      AND a.completed_at IS NULL
      AND a.supervisor_approved IS DISTINCT FROM true
    RETURNING a.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_room_ids FROM moved;

  -- Public-area tasks are published into general_tasks at release time;
  -- the saved plan's area-task rows are intentionally never rewritten.
  WITH moved AS (
    UPDATE public.general_tasks t
      SET assigned_to = p_to_staff_id, assigned_by = v_actor
    FROM public.next_day_housekeeping_plan_area_tasks area
    WHERE area.plan_id = v_plan.id
      AND area.assigned_to = p_from_staff_id
      AND t.next_day_plan_area_task_id = area.id
      AND t.organization_slug = v_plan.organization_slug
      AND t.assigned_date = v_plan.plan_date
      AND t.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
      AND t.assigned_to = p_from_staff_id
      AND t.status = 'assigned'
      AND t.started_at IS NULL
      AND t.completed_at IS NULL
    RETURNING t.id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_area_ids FROM moved;

  v_moved_rooms := cardinality(v_room_ids);
  v_moved_areas := cardinality(v_area_ids);

  IF v_moved_rooms + v_moved_areas = 0 THEN
    RAISE EXCEPTION 'No unstarted tasks remain for this employee. Tasks in progress were left untouched';
  END IF;

  INSERT INTO public.housekeeping_same_day_staff_replacements(
    plan_id, organization_slug, hotel_id, work_date,
    from_staff_id, to_staff_id, room_assignment_ids, area_task_ids,
    skipped_rooms, skipped_areas, replaced_by
  ) VALUES (
    v_plan.id, v_plan.organization_slug, v_plan.hotel_id, v_plan.plan_date,
    p_from_staff_id, p_to_staff_id, v_room_ids, v_area_ids,
    GREATEST(0, v_planned_rooms - v_moved_rooms),
    GREATEST(0, v_planned_areas - v_moved_areas), v_actor
  );

  RETURN jsonb_build_object(
    'movedRooms', v_moved_rooms,
    'movedAreas', v_moved_areas,
    'skippedRooms', GREATEST(0, v_planned_rooms - v_moved_rooms),
    'skippedAreas', GREATEST(0, v_planned_areas - v_moved_areas)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.replace_released_housekeeping_staff(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_released_housekeeping_staff(uuid,uuid,uuid) TO authenticated;
