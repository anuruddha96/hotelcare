-- Issue #260. Read-only impact assessment for an explicit, date-scoped transfer.
-- No staff duties, room assignments, public-area tasks or plan audit fields are changed.
-- This migration is stacked after 20260919065000_gozsdu_laundry_catalog_area_guards.sql.
CREATE OR REPLACE FUNCTION public.preview_gozsdu_laundry_reassignment(
  p_user_id uuid, p_work_date date
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.profiles%rowtype;
  v_staff public.profiles%rowtype;
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_plan_rooms jsonb := '[]'::jsonb;
  v_plan_areas jsonb := '[]'::jsonb;
  v_property_areas jsonb := '[]'::jsonb;
  v_live_rooms jsonb := '[]'::jsonb;
  v_live_areas jsonb := '[]'::jsonb;
  v_replacements jsonb := '[]'::jsonb;
  v_blocked integer := 0;
  v_state jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO v_staff FROM public.profiles WHERE id = p_user_id;
  IF v_actor.id IS NULL
    OR v_actor.role::text NOT IN ('manager','housekeeping_manager','admin','top_management','top_management_manager')
    OR v_actor.assigned_hotel NOT IN ('gozsdu-court','Gozsdu Court Budapest')
    OR v_staff.id IS NULL OR v_staff.deleted_at IS NOT NULL
    OR v_staff.organization_slug IS DISTINCT FROM v_actor.organization_slug
    OR v_staff.assigned_hotel NOT IN ('gozsdu-court','Gozsdu Court Budapest')
    OR NOT (v_staff.role::text = 'housekeeping' OR coalesce(v_staff.acts_as_housekeeper,false))
    OR p_work_date IS NULL OR p_work_date <> v_today + 1
  THEN
    RAISE EXCEPTION 'Unauthorized or invalid next-day Gozsdu Laundryner transfer preview' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_plan FROM public.next_day_housekeeping_plans
  WHERE organization_slug = v_actor.organization_slug AND hotel_id = 'gozsdu-court'
    AND plan_date = p_work_date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'room_id', i.room_id, 'room', r.room_number,
    'assigned_to', i.assigned_to, 'updated_at', i.updated_at,
    'role', coalesce(i.recommendation_context ->> 'assignment_role', i.source)
  ) ORDER BY i.id), '[]'::jsonb)
  INTO v_plan_rooms
  FROM public.next_day_housekeeping_plan_items i
  JOIN public.rooms r ON r.id = i.room_id AND r.organization_slug = v_actor.organization_slug
  WHERE i.plan_id = v_plan.id AND i.assigned_to = p_user_id
    AND v_plan.status IN ('draft','approved');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.task_name, 'assigned_to', a.assigned_to,
    'updated_at', a.updated_at
  ) ORDER BY a.id), '[]'::jsonb)
  INTO v_plan_areas
  FROM public.next_day_housekeeping_plan_area_tasks a
  WHERE a.plan_id = v_plan.id AND a.assigned_to = p_user_id
    AND v_plan.status IN ('draft','approved');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', area.name, 'assigned_to', a.assigned_to,
    'updated_at', a.updated_at
  ) ORDER BY a.id), '[]'::jsonb)
  INTO v_property_areas
  FROM public.next_day_housekeeping_public_area_assignments a
  JOIN public.hotel_public_areas area ON area.id = a.public_area_id
  WHERE a.organization_slug = v_actor.organization_slug
    AND a.hotel_id = 'gozsdu-court' AND a.plan_date = p_work_date
    AND a.assigned_to = p_user_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'room_id', a.room_id, 'room', r.room_number,
    'assigned_to', a.assigned_to, 'status', a.status::text,
    'started_at', a.started_at, 'completed_at', a.completed_at,
    'approved', a.supervisor_approved, 'updated_at', a.updated_at
  ) ORDER BY a.id), '[]'::jsonb),
  count(*) FILTER (WHERE a.status::text <> 'assigned' OR a.started_at IS NOT NULL
    OR a.completed_at IS NOT NULL OR coalesce(a.supervisor_approved,false))::integer
  INTO v_live_rooms, v_blocked
  FROM public.room_assignments a
  JOIN public.rooms r ON r.id = a.room_id
  WHERE r.organization_slug = v_actor.organization_slug
    AND r.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    AND a.assignment_date = p_work_date AND a.assigned_to = p_user_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.task_name, 'assigned_to', t.assigned_to,
    'status', t.status, 'started_at', t.started_at,
    'completed_at', t.completed_at, 'updated_at', t.updated_at
  ) ORDER BY t.id), '[]'::jsonb),
  v_blocked + count(*) FILTER (WHERE t.status <> 'assigned'
    OR t.started_at IS NOT NULL OR t.completed_at IS NOT NULL)::integer
  INTO v_live_areas, v_blocked
  FROM public.general_tasks t
  WHERE t.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    AND (t.organization_slug = v_actor.organization_slug OR t.organization_slug IS NULL)
    AND t.assigned_date = p_work_date AND t.assigned_to = p_user_id
    AND t.status <> 'cancelled';

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id,
    'name', p.full_name, 'nickname', p.nickname) ORDER BY p.full_name, p.id), '[]'::jsonb)
  INTO v_replacements
  FROM public.profiles p
  WHERE p.id <> p_user_id AND p.deleted_at IS NULL
    AND p.organization_slug = v_actor.organization_slug
    AND p.assigned_hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    AND (p.role::text = 'housekeeping' OR coalesce(p.acts_as_housekeeper,false))
    AND NOT EXISTS (SELECT 1 FROM public.gozsdu_laundry_duties d
      WHERE d.organization_slug = v_actor.organization_slug
        AND d.hotel_id = 'gozsdu-court' AND d.work_date = p_work_date AND d.user_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM public.staff_schedules s
      WHERE s.organization_slug = v_actor.organization_slug
        AND s.hotel_id = 'gozsdu-court' AND s.work_date = p_work_date
        AND s.user_id = p.id AND s.status = 'off')
    AND (v_plan.id IS NULL OR v_plan.status NOT IN ('draft','approved') OR EXISTS (
      SELECT 1 FROM public.next_day_housekeeping_plan_staff selected
      WHERE selected.plan_id = v_plan.id AND selected.user_id = p.id AND selected.selected));

  -- The fingerprint is bound to plan identity/version and every source work row.
  -- Commit compares it again under locks to reject a stale browser preview.
  v_state := jsonb_build_object(
    'hotel', 'gozsdu-court', 'organization', v_actor.organization_slug,
    'work_date', p_work_date, 'employee', p_user_id,
    'plan_id', v_plan.id, 'plan_status', v_plan.status,
    'plan_updated_at', v_plan.updated_at,
    'plan_release_attempted_at', v_plan.release_attempted_at,
    'plan_rooms', v_plan_rooms, 'plan_areas', v_plan_areas,
    'property_areas', v_property_areas,
    'live_rooms', v_live_rooms, 'live_areas', v_live_areas
  );

  RETURN jsonb_build_object(
    'token', md5(v_state::text), 'work', v_state,
    'blocked_started_or_completed', v_blocked,
    'release_locked', coalesce(v_plan.status IN ('releasing','released') OR v_plan.release_attempted_at IS NOT NULL,false),
    'already_laundryner', EXISTS (SELECT 1 FROM public.gozsdu_laundry_duties d
      WHERE d.organization_slug = v_actor.organization_slug AND d.hotel_id = 'gozsdu-court'
        AND d.work_date = p_work_date AND d.user_id = p_user_id),
    'counts', jsonb_build_object('plan_rooms', jsonb_array_length(v_plan_rooms),
      'plan_areas', jsonb_array_length(v_plan_areas),
      'property_areas', jsonb_array_length(v_property_areas),
      'live_rooms', jsonb_array_length(v_live_rooms),
      'live_areas', jsonb_array_length(v_live_areas)),
    'replacement_staff', v_replacements
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_gozsdu_laundry_reassignment(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_gozsdu_laundry_reassignment(uuid,date) TO authenticated;
