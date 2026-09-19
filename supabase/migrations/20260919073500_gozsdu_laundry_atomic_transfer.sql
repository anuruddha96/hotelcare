-- Issue #260. Stacked on catalog-duty guards (#263): must NOT deploy this alone.
-- All room/public-area ownership changes and duty selection succeed or roll back
-- together. Never delete assignments, touch rooms/PMS, or rewrite approval audits.
-- A tightly-scoped transaction-local context lets this SECURITY DEFINER RPC
-- update approved but not released plan children, without opening general edits.
ALTER FUNCTION public.preview_gozsdu_laundry_reassignment(uuid,date) VOLATILE;

CREATE OR REPLACE FUNCTION public.guard_next_day_housekeeping_child_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_status text;
  v_org text;
  v_hotel text;
  v_claim_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF auth.uid() IS NULL OR v_claim_role = 'service_role' THEN
    RETURN coalesce(new, old);
  END IF;
  v_plan_id := CASE WHEN tg_op = 'DELETE' THEN old.plan_id ELSE new.plan_id END;
  SELECT status, organization_slug, hotel_id INTO v_status, v_org, v_hotel
  FROM public.next_day_housekeeping_plans WHERE id = v_plan_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Housekeeping plan not found'; END IF;
  IF v_status <> 'draft' AND NOT (
    tg_op = 'UPDATE' AND v_status = 'approved' AND v_hotel = 'gozsdu-court'
    AND current_setting('hotelcare.laundry_transfer_plan_id', true) = v_plan_id::text
    AND current_setting('hotelcare.laundry_transfer_actor', true) = auth.uid()::text
    AND public.can_manage_next_day_housekeeping_plan(v_org, v_hotel)
  ) THEN
    RAISE EXCEPTION 'Plan staff and rooms can only be changed while the plan is draft';
  END IF;
  RETURN coalesce(new, old);
END;
$function$;

-- Preserve every existing mapped/legacy-area validation, except permitting
-- UPDATE (not INSERT/DELETE) inside the authorized approved-plan transfer RPC.
CREATE OR REPLACE FUNCTION public.validate_next_day_housekeeping_area_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_section_hotel text;
BEGIN
  SELECT * INTO v_plan FROM public.next_day_housekeeping_plans WHERE id = new.plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Next-day housekeeping plan does not exist'; END IF;
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF (now() AT TIME ZONE 'Europe/Budapest')::time < time '12:00' THEN
      RAISE EXCEPTION 'Tomorrow housekeeping planning is available after 12:00 Europe/Budapest';
    END IF;
    IF v_plan.status <> 'draft' AND NOT (
      tg_op = 'UPDATE' AND v_plan.status = 'approved' AND v_plan.hotel_id = 'gozsdu-court'
      AND current_setting('hotelcare.laundry_transfer_plan_id', true) = v_plan.id::text
      AND current_setting('hotelcare.laundry_transfer_actor', true) = auth.uid()::text
    ) THEN
      RAISE EXCEPTION 'Tomorrow public-area work can only be edited while the plan is a draft';
    END IF;
    IF NOT public.can_manage_next_day_housekeeping_plan(v_plan.organization_slug, v_plan.hotel_id) THEN
      RAISE EXCEPTION 'Not authorized to manage this tomorrow housekeeping plan';
    END IF;
    IF new.created_by IS DISTINCT FROM auth.uid() THEN
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

CREATE OR REPLACE FUNCTION public.transfer_gozsdu_work_to_laundryner(
  p_user_id uuid, p_replacement_id uuid, p_work_date date, p_expected_token text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor public.profiles%rowtype;
  v_source public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_plan public.next_day_housekeeping_plans%rowtype;
  v_preview jsonb;
  v_after jsonb;
  v_counts jsonb;
  v_count integer;
  v_planned_rooms integer := 0;
  v_planned_areas integer := 0;
  v_property_areas integer := 0;
  v_live_rooms integer := 0;
  v_live_areas integer := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  SELECT * INTO v_actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO v_source FROM public.profiles WHERE id = p_user_id;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_replacement_id;
  IF v_actor.id IS NULL OR v_actor.role::text NOT IN
    ('manager','housekeeping_manager','admin','top_management','top_management_manager')
    OR v_actor.assigned_hotel NOT IN ('gozsdu-court','Gozsdu Court Budapest')
    OR v_source.id IS NULL OR v_source.deleted_at IS NOT NULL
    OR v_source.organization_slug IS DISTINCT FROM v_actor.organization_slug
    OR v_source.assigned_hotel NOT IN ('gozsdu-court','Gozsdu Court Budapest')
    OR NOT (v_source.role::text = 'housekeeping' OR coalesce(v_source.acts_as_housekeeper,false))
    OR v_target.id IS NULL OR v_target.id = v_source.id OR v_target.deleted_at IS NOT NULL
    OR v_target.organization_slug IS DISTINCT FROM v_actor.organization_slug
    OR v_target.assigned_hotel NOT IN ('gozsdu-court','Gozsdu Court Budapest')
    OR NOT (v_target.role::text = 'housekeeping' OR coalesce(v_target.acts_as_housekeeper,false))
    OR p_work_date IS NULL OR p_work_date <> v_today + 1
    OR p_expected_token IS NULL OR length(p_expected_token) <> 32
  THEN
    RAISE EXCEPTION 'Unauthorized or invalid Gozsdu Laundryner transfer' USING ERRCODE='42501';
  END IF;
  IF (now() AT TIME ZONE 'Europe/Budapest')::time < time '12:00' THEN
    RAISE EXCEPTION 'Tomorrow housekeeping planning is available after 12:00 Europe/Budapest';
  END IF;

  -- Lock both staff/date keys in canonical order to avoid cross-transfer deadlocks.
  IF p_user_id::text < p_replacement_id::text THEN
    PERFORM public.gozsdu_laundry_lock(p_user_id, p_work_date);
    PERFORM public.gozsdu_laundry_lock(p_replacement_id, p_work_date);
  ELSE
    PERFORM public.gozsdu_laundry_lock(p_replacement_id, p_work_date);
    PERFORM public.gozsdu_laundry_lock(p_user_id, p_work_date);
  END IF;

  SELECT * INTO v_plan FROM public.next_day_housekeeping_plans
  WHERE organization_slug = v_actor.organization_slug AND hotel_id='gozsdu-court'
    AND plan_date=p_work_date FOR UPDATE;
  IF v_plan.id IS NOT NULL AND (v_plan.status NOT IN ('draft','approved')
    OR v_plan.release_attempted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Plan release has begun or plan cannot be edited; do not change Laundryner duty';
  END IF;

  -- Row locks keep an operational task from starting during the transfer.
  PERFORM a.id FROM public.room_assignments a JOIN public.rooms r ON r.id=a.room_id
  WHERE r.organization_slug=v_actor.organization_slug
    AND r.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    AND a.assignment_date=p_work_date AND a.assigned_to=p_user_id
  ORDER BY a.id FOR UPDATE OF a;
  PERFORM t.id FROM public.general_tasks t
  WHERE t.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    AND (t.organization_slug=v_actor.organization_slug OR t.organization_slug IS NULL)
    AND t.assigned_date=p_work_date AND t.assigned_to=p_user_id AND t.status <> 'cancelled'
  ORDER BY t.id FOR UPDATE;
  PERFORM i.id FROM public.next_day_housekeeping_plan_items i
  WHERE i.plan_id=v_plan.id AND i.assigned_to=p_user_id ORDER BY i.id FOR UPDATE;
  PERFORM a.id FROM public.next_day_housekeeping_plan_area_tasks a
  WHERE a.plan_id=v_plan.id AND a.assigned_to=p_user_id ORDER BY a.id FOR UPDATE;
  PERFORM a.id FROM public.next_day_housekeeping_public_area_assignments a
  WHERE a.organization_slug=v_actor.organization_slug AND a.hotel_id='gozsdu-court'
    AND a.plan_date=p_work_date AND a.assigned_to=p_user_id ORDER BY a.id FOR UPDATE;

  -- VOLATILE preview rereads source rows after locks. Any stale version fails
  -- before the first operational write; any subsequent SQL error rolls back all.
  v_preview := public.preview_gozsdu_laundry_reassignment(p_user_id,p_work_date);
  IF v_preview ->> 'token' IS DISTINCT FROM p_expected_token THEN
    RAISE EXCEPTION 'The schedule changed since preview. Refresh and review the transfer again' USING ERRCODE='40001';
  END IF;
  IF (v_preview ->> 'already_laundryner')::boolean
    OR (v_preview ->> 'release_locked')::boolean
    OR (v_preview ->> 'blocked_started_or_completed')::integer <> 0 THEN
    RAISE EXCEPTION 'Cannot transfer already-started, completed or released work';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gozsdu_laundry_duties d
    WHERE d.organization_slug=v_actor.organization_slug AND d.hotel_id='gozsdu-court'
      AND d.work_date=p_work_date AND d.user_id=p_replacement_id) THEN
    RAISE EXCEPTION 'Replacement worker is already Laundryner on this date';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_schedules s
    WHERE s.organization_slug=v_actor.organization_slug AND s.hotel_id='gozsdu-court'
      AND s.work_date=p_work_date AND s.user_id=p_replacement_id AND s.status='off') THEN
    RAISE EXCEPTION 'Replacement worker is scheduled Off';
  END IF;
  IF v_plan.id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.next_day_housekeeping_plan_staff s
    WHERE s.plan_id=v_plan.id AND s.user_id=p_replacement_id AND s.selected=true
  ) THEN
    RAISE EXCEPTION 'Select the replacement housekeeper in the plan staff list before transferring';
  END IF;
  IF EXISTS (SELECT 1 FROM public.next_day_housekeeping_plan_items old_item
    JOIN public.next_day_housekeeping_plan_items replacement
      ON replacement.plan_id=old_item.plan_id AND replacement.room_id=old_item.room_id
      AND replacement.assigned_to=p_replacement_id
    WHERE old_item.plan_id=v_plan.id AND old_item.assigned_to=p_user_id) THEN
    RAISE EXCEPTION 'Replacement already shares a room assigned to this employee; select another housekeeper';
  END IF;

  v_counts := v_preview -> 'counts';
  PERFORM set_config('hotelcare.laundry_transfer_plan_id',coalesce(v_plan.id::text,''),true);
  PERFORM set_config('hotelcare.laundry_transfer_actor',v_actor.id::text,true);

  UPDATE public.next_day_housekeeping_plan_items SET assigned_to=p_replacement_id
  WHERE plan_id=v_plan.id AND assigned_to=p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_planned_rooms := v_count;
  IF v_count <> (v_counts ->> 'plan_rooms')::integer THEN
    RAISE EXCEPTION 'Planned room transfer count changed; rolled back';
  END IF;

  UPDATE public.next_day_housekeeping_plan_area_tasks SET assigned_to=p_replacement_id
  WHERE plan_id=v_plan.id AND assigned_to=p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_planned_areas := v_count;
  IF v_count <> (v_counts ->> 'plan_areas')::integer THEN
    RAISE EXCEPTION 'Mapped/public-area transfer count changed; rolled back';
  END IF;

  UPDATE public.next_day_housekeeping_public_area_assignments
  SET assigned_to=p_replacement_id, updated_by=v_actor.id
  WHERE organization_slug=v_actor.organization_slug AND hotel_id='gozsdu-court'
    AND plan_date=p_work_date AND assigned_to=p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_property_areas := v_count;
  IF v_count <> (v_counts ->> 'property_areas')::integer THEN
    RAISE EXCEPTION 'Property-area transfer count changed; rolled back';
  END IF;

  UPDATE public.room_assignments a SET assigned_to=p_replacement_id, assigned_by=v_actor.id
  FROM public.rooms r WHERE r.id=a.room_id
    AND r.organization_slug=v_actor.organization_slug
    AND r.hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    AND a.assignment_date=p_work_date AND a.assigned_to=p_user_id
    AND a.status::text='assigned' AND a.started_at IS NULL
    AND a.completed_at IS NULL AND NOT coalesce(a.supervisor_approved,false);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_live_rooms := v_count;
  IF v_count <> (v_counts ->> 'live_rooms')::integer THEN
    RAISE EXCEPTION 'Live room transfer count changed; rolled back';
  END IF;

  UPDATE public.general_tasks SET assigned_to=p_replacement_id, assigned_by=v_actor.id
  WHERE hotel IN ('gozsdu-court','Gozsdu Court Budapest')
    AND (organization_slug=v_actor.organization_slug OR organization_slug IS NULL)
    AND assigned_date=p_work_date AND assigned_to=p_user_id
    AND status='assigned' AND started_at IS NULL AND completed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_live_areas := v_count;
  IF v_count <> (v_counts ->> 'live_areas')::integer THEN
    RAISE EXCEPTION 'Live public-area transfer count changed; rolled back';
  END IF;

  -- The source remains in the plan audit history; disable their cleaner
  -- selection only after all source plan assignments have moved.
  IF v_plan.id IS NOT NULL THEN
    UPDATE public.next_day_housekeeping_plan_staff SET selected=false
    WHERE plan_id=v_plan.id AND user_id=p_user_id AND selected=true;
  END IF;
  PERFORM set_config('hotelcare.laundry_transfer_plan_id','',true);
  PERFORM set_config('hotelcare.laundry_transfer_actor','',true);

  -- Authoritative setter performs a final conflict check across ALL five
  -- assignment sources (including the new catalog guard from #263).
  PERFORM public.set_gozsdu_laundry_duty(p_user_id,p_work_date,true);
  v_after := public.preview_gozsdu_laundry_reassignment(p_user_id,p_work_date);
  IF (v_after->'counts') <> jsonb_build_object('plan_rooms',0,'plan_areas',0,
    'property_areas',0,'live_rooms',0,'live_areas',0)
    OR NOT (v_after->>'already_laundryner')::boolean THEN
    RAISE EXCEPTION 'Transfer verification failed: all changes rolled back';
  END IF;

  RETURN jsonb_build_object('saved',true,'date',p_work_date,'hotel','gozsdu-court',
    'room_assignments_moved',v_planned_rooms + v_live_rooms,
    'public_area_assignments_moved',v_planned_areas + v_property_areas + v_live_areas,
    'duty','Laundryner');
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_gozsdu_work_to_laundryner(uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_gozsdu_work_to_laundryner(uuid,uuid,date,text) TO authenticated;
