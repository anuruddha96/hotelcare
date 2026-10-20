-- SLNT Team B only. A dirty stayover is not automatically a service task.
-- Date-specific towel, linen, explicit cleaning and manager requests qualify.
CREATE OR REPLACE FUNCTION public.slnt_team_b_stayover_due(p_room_id uuid,p_service_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.housekeeping_team_rooms tr ON tr.room_id=r.id AND tr.is_active
    JOIN public.housekeeping_teams team_scope ON team_scope.id=tr.team_id
    WHERE r.id=p_room_id AND r.organization_slug IN ('slnt','slnt-group')
      AND team_scope.organization_slug='slnt' AND team_scope.code='team-b' AND team_scope.is_active
      AND r.pms_metadata->>'pmsSyncDate'=p_service_date::text
      AND r.pms_metadata->>'pmsOccupancyStatus'='stayover'
      AND (
    coalesce(r.towel_change_required,false)
    OR coalesce(r.linen_change_required,false)
    OR r.pms_metadata->>'manual_daily'='true'
    OR (
      r.operational_note_date=p_service_date
      AND coalesce(nullif(btrim(r.hotelcare_planned_note_shadow),''),
                   nullif(btrim(r.notes),'')) IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.room_planned_notes n
      WHERE n.room_id=r.id AND n.organization_slug IN ('slnt','slnt-group')
        AND n.status='active'
        AND lower(n.instruction_type) IN (
          'cleaning','housekeeping','special_request','special_cleaning',
          'towel_change','linen_change','daily_cleaning'
        )
        AND (p_service_date BETWEEN n.start_date AND coalesce(n.end_date,n.start_date)
             OR p_service_date=ANY(n.selected_dates))
    )
    OR EXISTS (
      SELECT 1 FROM public.housekeeping_team_tasks task
      JOIN public.housekeeping_teams team ON team.id=task.team_id
      WHERE task.room_id=r.id AND task.service_date=p_service_date
        AND team.organization_slug='slnt' AND team.code='team-b'
        AND task.status NOT IN ('cancelled','completed')
        AND task.assignment_type::text='daily_cleaning'
    )
  )
  );
$$;
REVOKE ALL ON FUNCTION public.slnt_team_b_stayover_due(uuid,date) FROM PUBLIC;
-- This helper is callable only indirectly through the manager/cleaner-scoped
-- SECURITY DEFINER worklist and claim functions.


CREATE OR REPLACE FUNCTION public.slnt_team_b_claim_room(p_room_id uuid, p_service_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_team_id uuid; v_org_slug text; v_room public.rooms%ROWTYPE;
        v_assignment public.room_assignments%ROWTYPE;
BEGIN
  IF NOT public.slnt_simple_housekeeping_enabled() THEN
    RAISE EXCEPTION 'SLNT simplified housekeeping rollout is not enabled'; END IF;
  IF p_service_date <> (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Only today''s Team B rooms may be claimed';
  END IF;
  SELECT t.id INTO v_team_id FROM public.housekeeping_teams t
    WHERE t.organization_slug='slnt' AND t.code='team-b' AND t.is_active LIMIT 1;
  SELECT p.organization_slug INTO v_org_slug FROM public.profiles p WHERE p.id=auth.uid();
  IF v_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.housekeeping_team_members m
    JOIN public.profiles p ON p.id=m.user_id
    WHERE m.team_id=v_team_id AND m.user_id=auth.uid() AND m.is_active
      AND p.organization_slug IN ('slnt','slnt-group') AND p.role='housekeeping'
      AND (m.effective_from IS NULL OR m.effective_from<=p_service_date)
      AND (m.effective_to IS NULL OR m.effective_to>=p_service_date)
  ) THEN RAISE EXCEPTION 'Active Team B cleaner membership required' USING ERRCODE='42501'; END IF;
  -- Default-working policy: a Team B cleaner cannot claim on a manager-marked absence day.
  IF EXISTS (
    SELECT 1 FROM public.slnt_team_b_days_off d
    WHERE d.team_id=v_team_id AND d.user_id=auth.uid()
      AND d.work_date=p_service_date
  ) THEN RAISE EXCEPTION 'You are marked not working today. Ask the manager to restore availability.';
  END IF;
  SELECT r.* INTO v_room FROM public.rooms r
    JOIN public.housekeeping_team_rooms tr ON tr.room_id=r.id AND tr.team_id=v_team_id AND tr.is_active
    WHERE r.id=p_room_id AND r.organization_slug IN ('slnt','slnt-group')
    FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room is not assigned to SLNT Team B'; END IF;
  IF lower(coalesce(v_room.status,'')) IN ('clean','cleaned','ready','out_of_order','out_of_service','blocked','maintenance') THEN
    RAISE EXCEPTION 'Room is already clean or unavailable';
  END IF;
  IF v_room.pms_metadata->>'pmsSyncDate' IS DISTINCT FROM p_service_date::text
    OR v_room.updated_at < (p_service_date::timestamp AT TIME ZONE 'Europe/Budapest') THEN
    RAISE EXCEPTION 'Room PMS status is not current; refresh before claiming';
  END IF;
  IF lower(coalesce(v_room.status,'')) NOT IN
    ('dirty','unclean','needs_cleaning','needs cleaning','to_clean','checkout_dirty')
    OR NOT (
      (v_room.pms_metadata->>'scheduledDepartureToday'='true'
        AND v_room.pms_metadata->>'pmsOccupancyStatus'='departing')
      OR public.slnt_team_b_stayover_due(p_room_id,p_service_date)
    ) THEN RAISE EXCEPTION 'Room has no confirmed housekeeping task today'; END IF;

  -- A checkout cannot be started before RTC/confirmed checkout. Stayovers are unaffected.
  IF (coalesce(v_room.is_checkout_room,false)
      OR (v_room.pms_metadata->>'scheduledDepartureToday'='true'
        AND v_room.pms_metadata->>'pmsOccupancyStatus'='departing'))
    AND NOT (
      (v_room.pms_metadata->>'checkedOutToday')='true'
      OR (
        (v_room.pms_metadata->>'readyToClean')='true'
        AND v_room.pms_metadata->>'readyToCleanDate'=p_service_date::text
      )
    ) THEN
      RAISE EXCEPTION 'Awaiting checkout / RTC. This room is not yet ready to clean.';
  END IF;
  SELECT * INTO v_assignment FROM public.room_assignments
    WHERE room_id=p_room_id AND assignment_date=p_service_date
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND v_assignment.status <> 'cancelled' THEN
    IF v_assignment.assigned_to=auth.uid() THEN RETURN v_assignment.id; END IF;
    RAISE EXCEPTION 'Another cleaner has claimed or completed this room';
  END IF;
  IF FOUND AND v_assignment.status = 'cancelled' THEN
    UPDATE public.room_assignments SET assigned_to=auth.uid(),assigned_by=auth.uid(),
      organization_slug=v_org_slug,status='assigned',completed_at=null,started_at=null,
      supervisor_approved=false,supervisor_approved_by=null,supervisor_approved_at=null
      WHERE id=v_assignment.id RETURNING id INTO v_assignment.id;
    RETURN v_assignment.id;
  END IF;

  INSERT INTO public.room_assignments (
    room_id,assigned_to,assigned_by,assignment_date,organization_slug,
    assignment_type,status,priority,ready_to_clean,supervisor_approved
  ) VALUES (
    p_room_id,auth.uid(),auth.uid(),p_service_date,v_org_slug,
    CASE WHEN (coalesce(v_room.is_checkout_room,false)
       OR (v_room.pms_metadata->>'scheduledDepartureToday'='true'
         AND v_room.pms_metadata->>'pmsOccupancyStatus'='departing')) THEN 'checkout_cleaning'
         ELSE 'daily_cleaning' END::public.assignment_type,
    'assigned',2,CASE WHEN (coalesce(v_room.is_checkout_room,false)
       OR (v_room.pms_metadata->>'scheduledDepartureToday'='true'
         AND v_room.pms_metadata->>'pmsOccupancyStatus'='departing'))
         THEN (v_room.pms_metadata->>'checkedOutToday'='true'
           OR (v_room.pms_metadata->>'readyToClean'='true'
             AND v_room.pms_metadata->>'readyToCleanDate'=p_service_date::text))
         ELSE true END,false
  ) RETURNING id INTO v_assignment.id;
  RETURN v_assignment.id;
END $function$;

CREATE OR REPLACE FUNCTION public.slnt_team_b_worklist(p_service_date date)
 RETURNS TABLE(room_id uuid, room_number text, room_status text, room_name text, notes text, guest_count integer, is_checkout_room boolean, towel_change_required boolean, linen_change_required boolean, pms_metadata jsonb, assignment_id uuid, assigned_to uuid, assignment_status text, supervisor_approved boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_team_id uuid;
BEGIN
  IF NOT public.slnt_simple_housekeeping_enabled() THEN
    RAISE EXCEPTION 'SLNT simplified housekeeping rollout is not enabled'; END IF;
  IF p_service_date <> (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Team B shared worklist is available for today only';
  END IF;
  -- Today's room-state refresh is authoritative. Old daily-overview
  -- snapshots may be several days stale even when business_date is today.
  IF NOT EXISTS (
    SELECT 1 FROM public.housekeeping_team_rooms tr
    JOIN public.housekeeping_teams t ON t.id=tr.team_id
    JOIN public.rooms r ON r.id=tr.room_id
    WHERE t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
      AND tr.is_active AND r.pms_metadata->>'pmsSyncDate'=p_service_date::text
      AND r.updated_at >= (p_service_date::timestamp AT TIME ZONE 'Europe/Budapest')
  ) THEN RAISE EXCEPTION 'SLNT Team B PMS data is stale; refresh rooms before claiming'; END IF;
  SELECT t.id INTO v_team_id FROM public.housekeeping_teams t
    WHERE t.organization_slug = 'slnt' AND t.code = 'team-b' AND t.is_active
    LIMIT 1;
  IF v_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.organization_slug IN ('slnt','slnt-group')
      AND (p.role IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
        OR EXISTS (SELECT 1 FROM public.housekeeping_team_members m
                   WHERE m.team_id=v_team_id AND m.user_id=p.id AND m.is_active
                   AND (m.effective_from IS NULL OR m.effective_from <= p_service_date)
                   AND (m.effective_to IS NULL OR m.effective_to >= p_service_date)))
  ) THEN RAISE EXCEPTION 'SLNT Team B access required' USING ERRCODE='42501'; END IF;
  -- Marked-off cleaners cannot pull tasks from today's shared worklist.
  IF EXISTS (
    SELECT 1 FROM public.slnt_team_b_days_off d
    WHERE d.team_id=v_team_id AND d.user_id=auth.uid() AND d.work_date=p_service_date
  ) THEN RAISE EXCEPTION 'You are marked not working today. Ask your manager to restore access.';
  END IF;
  RETURN QUERY
  SELECT r.id, r.room_number, r.status, r.room_name, r.notes,
         r.guest_count, (coalesce(r.is_checkout_room,false) OR (r.pms_metadata->>'pmsOccupancyStatus'='departing'
          AND r.pms_metadata->>'scheduledDepartureToday'='true')),
         coalesce(r.towel_change_required,false), coalesce(r.linen_change_required,false),
         r.pms_metadata::jsonb,
         a.id, a.assigned_to, a.status::text, coalesce(a.supervisor_approved,false)
  FROM public.housekeeping_team_rooms tr
  JOIN public.rooms r ON r.id=tr.room_id AND r.organization_slug IN ('slnt','slnt-group')
  LEFT JOIN LATERAL (
    SELECT ra.id,ra.assigned_to,ra.status,ra.supervisor_approved
    FROM public.room_assignments ra
    WHERE ra.room_id=r.id AND ra.assignment_date=p_service_date
      AND ra.status <> 'cancelled'
    ORDER BY ra.created_at DESC LIMIT 1
  ) a ON true
  WHERE tr.team_id=v_team_id AND tr.is_active
    AND r.pms_metadata->>'pmsSyncDate'=p_service_date::text
    AND r.updated_at >= (p_service_date::timestamp AT TIME ZONE 'Europe/Budapest')
    AND lower(coalesce(r.status,'')) NOT IN ('out_of_order','out_of_service','blocked','maintenance')
    AND (
      a.id IS NOT NULL
      -- Visible even when checkout is still occupied or RTC is pending.
      OR ((r.pms_metadata->>'pmsOccupancyStatus'='departing'
          AND r.pms_metadata->>'scheduledDepartureToday'='true')
          AND (NOT (r.pms_metadata->>'checkedOutToday'='true'
              OR (r.pms_metadata->>'readyToClean'='true'
                AND r.pms_metadata->>'readyToCleanDate'=p_service_date::text)) OR lower(coalesce(r.status,'')) IN
              ('dirty','unclean','needs_cleaning','needs cleaning','to_clean','checkout_dirty')))
      -- Only explicitly due daily services qualify; never all stayovers.
      OR (lower(coalesce(r.status,'')) IN
              ('dirty','unclean','needs_cleaning','needs cleaning','to_clean','checkout_dirty') AND public.slnt_team_b_stayover_due(r.id,p_service_date))
    )
  ORDER BY coalesce(r.is_checkout_room,false) DESC, r.room_number;
END $function$;

