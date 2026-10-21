-- SLNT-only v4: virtual default-working calendar and team pool.  No RD Hotels
-- scheduling, room management or PMS synchronization tables are modified.
ALTER TABLE public.slnt_team_b_days_off
  ADD COLUMN IF NOT EXISTS absence_kind text NOT NULL DEFAULT 'day_off';
ALTER TABLE public.slnt_team_b_days_off DROP CONSTRAINT IF EXISTS slnt_team_b_absence_kind_check;
ALTER TABLE public.slnt_team_b_days_off
  ADD CONSTRAINT slnt_team_b_absence_kind_check
  CHECK (absence_kind IN ('day_off','annual_leave','sick_leave'));

-- Preserve existing explicit future days off; do not publish shifts or invent
-- shifts for the many empty roster cells.
INSERT INTO public.slnt_team_b_days_off(team_id,user_id,work_date,created_by,absence_kind)
SELECT t.id,s.user_id,s.work_date,s.created_by,'day_off'
FROM public.staff_schedules s
JOIN public.housekeeping_teams t
  ON t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
JOIN public.housekeeping_team_members m
  ON m.team_id=t.id AND m.user_id=s.user_id AND m.is_active
WHERE s.organization_slug IN ('slnt','slnt-group') AND s.status='off'
  AND s.work_date >= (now() AT TIME ZONE 'Europe/Budapest')::date
ON CONFLICT (team_id,user_id,work_date) DO NOTHING;

CREATE OR REPLACE FUNCTION public.slnt_team_b_calendar_v4(p_start date,p_end date)
RETURNS TABLE(work_date date, user_id uuid, staff_name text, is_working boolean, absence_kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end<p_start OR p_end-p_start>34 THEN
    RAISE EXCEPTION 'Select up to 35 days'; END IF;
  IF NOT public.slnt_simple_housekeeping_enabled('slnt')
     OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
      AND p.organization_slug IN ('slnt','slnt-group') AND
      p.role::text IN ('admin','manager','housekeeping_manager','top_management','top_management_manager'))
  THEN RAISE EXCEPTION 'SLNT manager access required' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT d.dt::date,m.user_id,coalesce(nullif(p.full_name,''),'Housekeeper'),
         offday.user_id IS NULL,offday.absence_kind
  FROM generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d(dt)
  JOIN public.housekeeping_teams t
    ON t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
  JOIN public.housekeeping_team_members m ON m.team_id=t.id AND m.is_active
    AND (m.effective_from IS NULL OR m.effective_from<=d.dt::date)
    AND (m.effective_to IS NULL OR m.effective_to>=d.dt::date)
  JOIN public.profiles p ON p.id=m.user_id
    AND p.organization_slug IN ('slnt','slnt-group') AND p.role::text='housekeeping'
    AND p.deleted_at IS NULL
  LEFT JOIN public.slnt_team_b_days_off offday
    ON offday.team_id=t.id AND offday.user_id=m.user_id AND offday.work_date=d.dt::date
  ORDER BY p.full_name,d.dt;
END $fn$;
REVOKE ALL ON FUNCTION public.slnt_team_b_calendar_v4(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_calendar_v4(date,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.slnt_team_b_set_availability_v4(
  p_user_id uuid,p_work_date date,p_absence_kind text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_team_id uuid;
BEGIN
  IF p_work_date IS NULL OR p_work_date < (now() AT TIME ZONE 'Europe/Budapest')::date
     OR p_work_date > (now() AT TIME ZONE 'Europe/Budapest')::date+90
  THEN RAISE EXCEPTION 'Only today or the next 90 days can be changed'; END IF;
  IF p_absence_kind IS NOT NULL AND p_absence_kind NOT IN ('day_off','annual_leave','sick_leave')
  THEN RAISE EXCEPTION 'Invalid availability status'; END IF;
  IF NOT public.slnt_simple_housekeeping_enabled('slnt') OR NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
      AND p.organization_slug IN ('slnt','slnt-group')
      AND p.role::text IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
  ) THEN RAISE EXCEPTION 'SLNT manager access required' USING ERRCODE='42501'; END IF;
  SELECT t.id INTO v_team_id
  FROM public.housekeeping_teams t
  JOIN public.housekeeping_team_members m ON m.team_id=t.id AND m.user_id=p_user_id AND m.is_active
  JOIN public.profiles p ON p.id=m.user_id AND p.organization_slug IN ('slnt','slnt-group')
     AND p.role::text='housekeeping' AND p.deleted_at IS NULL
  WHERE t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
    AND (m.effective_from IS NULL OR m.effective_from<=p_work_date)
    AND (m.effective_to IS NULL OR m.effective_to>=p_work_date)
  LIMIT 1;
  IF v_team_id IS NULL THEN RAISE EXCEPTION 'Housekeeper is not an active SLNT Team B member'; END IF;
  IF p_absence_kind IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.room_assignments a
      JOIN public.housekeeping_team_rooms tr ON tr.room_id=a.room_id
        AND tr.team_id=v_team_id AND tr.is_active
      WHERE a.assigned_to=p_user_id AND a.assignment_date=p_work_date
        AND a.status::text NOT IN ('cancelled')
    ) THEN RAISE EXCEPTION 'Release or reassign this cleaner''s existing room work first'; END IF;
    INSERT INTO public.slnt_team_b_days_off(team_id,user_id,work_date,created_by,absence_kind)
    VALUES(v_team_id,p_user_id,p_work_date,auth.uid(),p_absence_kind)
    ON CONFLICT(team_id,user_id,work_date) DO UPDATE
      SET absence_kind=excluded.absence_kind,created_by=excluded.created_by,created_at=now();
  ELSE
    DELETE FROM public.slnt_team_b_days_off
    WHERE team_id=v_team_id AND user_id=p_user_id AND work_date=p_work_date;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.slnt_team_b_set_availability_v4(uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_set_availability_v4(uuid,date,text) TO authenticated;

-- Everyone in SLNT Team B can view the due list through the already
-- authorization-checked worklist. Optional stayovers are visible separately:
-- never count these as due/overdue, never override guest DND or no-service.
CREATE OR REPLACE FUNCTION public.slnt_team_b_pool_v4(p_service_date date)
RETURNS TABLE(
  room_id uuid,room_number text,room_status text,room_name text,notes text,
  guest_count integer,is_checkout_room boolean,towel_change_required boolean,
  linen_change_required boolean,pms_metadata jsonb,assignment_id uuid,
  assigned_to uuid,assignment_status text,supervisor_approved boolean,
  is_optional boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  -- Enforce the existing tenant, membership, manager and absence policies.
  PERFORM 1 FROM public.slnt_team_b_worklist(p_service_date) LIMIT 1;
  RETURN QUERY
  WITH due AS MATERIALIZED (
    SELECT * FROM public.slnt_team_b_worklist(p_service_date)
  )
  SELECT due.room_id,due.room_number,due.room_status,due.room_name,due.notes,
         due.guest_count,due.is_checkout_room,due.towel_change_required,
         due.linen_change_required,due.pms_metadata,due.assignment_id,
         due.assigned_to,due.assignment_status,due.supervisor_approved,false
  FROM due
  JOIN public.rooms room_scope ON room_scope.id=due.room_id
  WHERE (
    (NOT coalesce(room_scope.is_dnd,false)
       AND coalesce(room_scope.notes,'') NOT ILIKE '%[NO_SERVICE]%'
       AND coalesce(room_scope.notes,'') NOT ILIKE '%[DND]%')
    OR due.assignment_id IS NOT NULL
  )
  UNION ALL
  SELECT r.id,r.room_number,r.status,r.room_name,r.notes,r.guest_count,
         false,coalesce(r.towel_change_required,false),coalesce(r.linen_change_required,false),
         r.pms_metadata,NULL::uuid,NULL::uuid,NULL::text,false,true
  FROM public.housekeeping_team_rooms tr
  JOIN public.housekeeping_teams t ON t.id=tr.team_id AND t.organization_slug='slnt'
    AND t.code='team-b' AND t.is_active
  JOIN public.rooms r ON r.id=tr.room_id AND r.organization_slug IN ('slnt','slnt-group')
  WHERE tr.is_active
    AND r.pms_metadata->>'pmsSyncDate'=p_service_date::text
    AND r.updated_at >= (p_service_date::timestamp AT TIME ZONE 'Europe/Budapest')
    AND r.pms_metadata->>'pmsOccupancyStatus'='stayover'
    AND lower(coalesce(r.status,'')) IN ('dirty','unclean','needs_cleaning','needs cleaning','to_clean')
    AND NOT coalesce(r.is_dnd,false)
    AND coalesce(r.notes,'') NOT ILIKE '%[NO_SERVICE]%'
    AND coalesce(r.notes,'') NOT ILIKE '%[DND]%'
    AND NOT EXISTS (SELECT 1 FROM due WHERE due.room_id=r.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.room_assignments a
      WHERE a.room_id=r.id AND a.assignment_date=p_service_date
        AND a.status::text<>'cancelled'
    );
END $fn$;
REVOKE ALL ON FUNCTION public.slnt_team_b_pool_v4(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_pool_v4(date) TO authenticated;

-- Atomic Team B Start: no manager shift publication, no pre-distribution.
-- Room lock prevents competing cleaners. Existing housekeeper room card,
-- photo requirements and supervisor approval flow remain unchanged.
CREATE OR REPLACE FUNCTION public.slnt_team_b_start_room_v4(p_room_id uuid,p_service_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_team uuid;v_org text;v_room public.rooms%ROWTYPE;
  v_existing public.room_assignments%ROWTYPE;
  v_is_checkout boolean;v_is_due boolean;v_optional boolean;v_new_id uuid;
BEGIN
  IF NOT public.slnt_simple_housekeeping_enabled('slnt')
    OR p_service_date IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Budapest')::date
  THEN RAISE EXCEPTION 'SLNT Team B is not active for the requested day'; END IF;
  SELECT t.id INTO v_team FROM public.housekeeping_teams t
  WHERE t.organization_slug='slnt' AND t.code='team-b' AND t.is_active LIMIT 1;
  SELECT p.organization_slug INTO v_org FROM public.profiles p
  JOIN public.housekeeping_team_members m ON m.user_id=p.id AND m.team_id=v_team
    AND m.is_active AND (m.effective_from IS NULL OR m.effective_from<=p_service_date)
    AND (m.effective_to IS NULL OR m.effective_to>=p_service_date)
  WHERE p.id=auth.uid() AND p.organization_slug IN ('slnt','slnt-group')
    AND p.role::text='housekeeping' AND p.deleted_at IS NULL;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Active SLNT Team B cleaner required' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.slnt_team_b_days_off d
    WHERE d.team_id=v_team AND d.user_id=auth.uid() AND d.work_date=p_service_date)
  THEN RAISE EXCEPTION 'Marked not working today'; END IF;
  -- Respect the existing active-break/checked-out restrictions while allowing
  -- SLNT to operate without a published shift or synthetic attendance entry.
  IF EXISTS (
    SELECT 1 FROM public.staff_attendance att
    WHERE att.user_id=auth.uid() AND att.work_date=p_service_date
      AND (att.status IN ('on_break','checked_out')
         OR (att.check_out_time IS NOT NULL AND att.check_in_time IS NOT NULL))
  ) THEN RAISE EXCEPTION 'Finish your break or contact your manager before starting another room'; END IF;
  SELECT r.* INTO v_room FROM public.rooms r
  JOIN public.housekeeping_team_rooms tr ON tr.room_id=r.id AND tr.team_id=v_team AND tr.is_active
  WHERE r.id=p_room_id AND r.organization_slug IN ('slnt','slnt-group') FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room is not mapped to SLNT Team B'; END IF;
  IF v_room.pms_metadata->>'pmsSyncDate' IS DISTINCT FROM p_service_date::text
    OR v_room.updated_at < (p_service_date::timestamp AT TIME ZONE 'Europe/Budapest')
  THEN RAISE EXCEPTION 'Refresh PMS status before starting this room'; END IF;
  IF lower(coalesce(v_room.status,'')) IN ('out_of_order','out_of_service','blocked','maintenance')
     OR coalesce(v_room.is_dnd,false)
     OR coalesce(v_room.notes,'') ILIKE '%[NO_SERVICE]%'
     OR coalesce(v_room.notes,'') ILIKE '%[DND]%'
  THEN RAISE EXCEPTION 'Room is not available for housekeeping'; END IF;
  v_is_checkout := v_room.pms_metadata->>'pmsOccupancyStatus'='departing'
                   AND v_room.pms_metadata->>'scheduledDepartureToday'='true';
  v_is_due := public.slnt_team_b_stayover_due(p_room_id,p_service_date);
  v_optional := v_room.pms_metadata->>'pmsOccupancyStatus'='stayover'
    AND lower(coalesce(v_room.status,'')) IN ('dirty','unclean','needs_cleaning','needs cleaning','to_clean')
    AND NOT v_is_due;
  IF v_is_checkout THEN
    IF lower(coalesce(v_room.status,'')) NOT IN ('dirty','unclean','needs_cleaning','needs cleaning','to_clean','checkout_dirty')
      OR NOT (
        v_room.pms_metadata->>'checkedOutToday'='true'
        OR (v_room.pms_metadata->>'readyToClean'='true'
            AND v_room.pms_metadata->>'readyToCleanDate'=p_service_date::text)
      )
    THEN RAISE EXCEPTION 'Awaiting RTC or checkout; cleaning cannot start'; END IF;
  ELSIF NOT v_is_due AND NOT v_optional THEN
    RAISE EXCEPTION 'Room has no eligible stayover work today';
  END IF;
  -- Existing start behavior permits one ordinary active room per cleaner.
  IF EXISTS (
    SELECT 1 FROM public.room_assignments a
    WHERE a.assigned_to=auth.uid() AND a.assignment_date=p_service_date
      AND a.status::text='in_progress' AND a.room_id<>p_room_id
  ) THEN RAISE EXCEPTION 'Finish the room already in progress before starting another'; END IF;
  SELECT * INTO v_existing FROM public.room_assignments a
  WHERE a.room_id=p_room_id AND a.assignment_date=p_service_date AND a.status::text<>'cancelled'
  ORDER BY a.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_existing.assigned_to IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Room has already been claimed by another cleaner'; END IF;
    IF v_existing.status::text='in_progress' THEN RETURN v_existing.id; END IF;
    IF v_existing.status::text<>'assigned' THEN
      RAISE EXCEPTION 'Room is already completed or unavailable'; END IF;
    UPDATE public.room_assignments SET status='in_progress',started_at=now(),ready_to_clean=true
    WHERE id=v_existing.id RETURNING id INTO v_new_id;
    RETURN v_new_id;
  END IF;
  INSERT INTO public.room_assignments(
    room_id,assigned_to,assigned_by,assignment_date,organization_slug,
    assignment_type,status,priority,ready_to_clean,started_at,supervisor_approved
  ) VALUES(
    p_room_id,auth.uid(),auth.uid(),p_service_date,v_org,
    (CASE WHEN v_is_checkout THEN 'checkout_cleaning' ELSE 'daily_cleaning' END)::public.assignment_type,
    'in_progress',CASE WHEN v_is_checkout THEN 3 WHEN v_is_due THEN 2 ELSE 1 END,
    true,now(),false
  ) RETURNING id INTO v_new_id;
  RETURN v_new_id;
END $fn$;
REVOKE ALL ON FUNCTION public.slnt_team_b_start_room_v4(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_start_room_v4(uuid,date) TO authenticated;

-- Older manager tools can still manually create room assignments. Do not
-- bypass an explicit SLNT Team B absence via those legacy assignment paths.
CREATE OR REPLACE FUNCTION public.slnt_team_b_guard_absent_assignment_v4()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
BEGIN
  IF NEW.organization_slug NOT IN ('slnt','slnt-group') OR NEW.assigned_to IS NULL
     OR NOT public.slnt_simple_housekeeping_enabled('slnt') THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.housekeeping_team_rooms tr
    JOIN public.housekeeping_teams t ON t.id=tr.team_id
      AND t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
    JOIN public.slnt_team_b_days_off d ON d.team_id=t.id AND d.user_id=NEW.assigned_to
      AND d.work_date=NEW.assignment_date
    WHERE tr.room_id=NEW.room_id AND tr.is_active
  ) THEN RAISE EXCEPTION 'Cannot assign Team B room to an absent housekeeper'; END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS slnt_team_b_guard_absent_assignment_v4 ON public.room_assignments;
CREATE TRIGGER slnt_team_b_guard_absent_assignment_v4
  BEFORE INSERT OR UPDATE OF assigned_to,room_id,assignment_date
  ON public.room_assignments FOR EACH ROW
  EXECUTE FUNCTION public.slnt_team_b_guard_absent_assignment_v4();
