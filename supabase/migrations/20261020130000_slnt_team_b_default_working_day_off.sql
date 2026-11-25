-- SLNT-only Team B: every active member is working by default.
-- Managers mark only exceptions. Does not alter RD Hotels roster semantics.
CREATE TABLE IF NOT EXISTS public.slnt_team_b_days_off (
  team_id uuid NOT NULL REFERENCES public.housekeeping_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id,user_id,work_date)
);
ALTER TABLE public.slnt_team_b_days_off ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slnt_team_b_days_off FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.slnt_team_b_days_off TO authenticated;
CREATE POLICY slnt_team_b_days_off_read ON public.slnt_team_b_days_off
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.housekeeping_teams t
      JOIN public.profiles p ON p.id=auth.uid()
      WHERE t.id=team_id AND t.code='team-b' AND t.organization_slug='slnt'
        AND t.is_active AND p.organization_slug IN ('slnt','slnt-group')
        AND (
          p.id=user_id
          OR p.role::text IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
        )
    )
  );

CREATE OR REPLACE FUNCTION public.slnt_team_b_active_staff(p_date date DEFAULT (now() AT TIME ZONE 'Europe/Budapest')::date)
RETURNS TABLE(user_id uuid, staff_name text, is_working boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_date IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Team B daily availability is for today';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
      AND p.organization_slug IN ('slnt','slnt-group')
      AND p.role::text IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
  ) THEN RAISE EXCEPTION 'SLNT management permission required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT m.user_id, coalesce(nullif(p.full_name,''),'Housekeeper'),
    NOT EXISTS (
      SELECT 1 FROM public.slnt_team_b_days_off d
      WHERE d.team_id=m.team_id AND d.user_id=m.user_id AND d.work_date=p_date
    )
  FROM public.housekeeping_team_members m
  JOIN public.housekeeping_teams t ON t.id=m.team_id
  JOIN public.profiles p ON p.id=m.user_id
  WHERE t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
    AND m.is_active AND p.deleted_at IS NULL
    AND p.organization_slug IN ('slnt','slnt-group')
    AND (m.effective_from IS NULL OR m.effective_from<=p_date)
    AND (m.effective_to IS NULL OR m.effective_to>=p_date)
  ORDER BY p.full_name;
END $$;
REVOKE ALL ON FUNCTION public.slnt_team_b_active_staff(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_active_staff(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.slnt_team_b_set_day_off(
  p_user_id uuid,p_work_date date,p_is_off boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_team uuid;
BEGIN
  IF p_work_date IS DISTINCT FROM (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Only current day availability may be changed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=auth.uid() AND p.organization_slug IN ('slnt','slnt-group')
      AND p.role::text IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
  ) THEN RAISE EXCEPTION 'SLNT manager required' USING ERRCODE='42501'; END IF;
  SELECT t.id INTO v_team
  FROM public.housekeeping_teams t
  JOIN public.housekeeping_team_members m ON m.team_id=t.id
  JOIN public.profiles p ON p.id=m.user_id
  WHERE t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
    AND m.is_active AND m.user_id=p_user_id AND p.organization_slug IN ('slnt','slnt-group')
    AND (m.effective_from IS NULL OR m.effective_from<=p_work_date)
    AND (m.effective_to IS NULL OR m.effective_to>=p_work_date)
  LIMIT 1;
  IF v_team IS NULL THEN RAISE EXCEPTION 'Housekeeper is not an active SLNT Team B member'; END IF;

  IF p_is_off THEN
    IF EXISTS (
      SELECT 1 FROM public.room_assignments a
      JOIN public.housekeeping_team_rooms tr ON tr.room_id=a.room_id
      WHERE tr.team_id=v_team AND tr.is_active AND a.assigned_to=p_user_id
        AND a.assignment_date=p_work_date AND a.status::text NOT IN ('cancelled')
    ) THEN RAISE EXCEPTION 'Reassign or release existing room work before marking this cleaner off'; END IF;
    INSERT INTO public.slnt_team_b_days_off(team_id,user_id,work_date,created_by)
    VALUES(v_team,p_user_id,p_work_date,auth.uid())
    ON CONFLICT(team_id,user_id,work_date) DO NOTHING;
  ELSE
    DELETE FROM public.slnt_team_b_days_off d
    WHERE d.team_id=v_team AND d.user_id=p_user_id AND d.work_date=p_work_date;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.slnt_team_b_set_day_off(uuid,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_set_day_off(uuid,date,boolean) TO authenticated;

-- Extend existing shared claim/worklist access checks. All old controls preserved.
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
      OR (v_room.pms_metadata->>'pmsOccupancyStatus'='stayover'
        AND (coalesce(v_room.towel_change_required,false) OR coalesce(v_room.linen_change_required,false)))
    ) THEN RAISE EXCEPTION 'Room has no confirmed housekeeping task today'; END IF;

  -- A checkout cannot be started before RTC/confirmed checkout. Stayovers are unaffected.
  IF coalesce(v_room.is_checkout_room,false)
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
    CASE WHEN coalesce(v_room.is_checkout_room,false) THEN 'checkout_cleaning'
         ELSE 'daily_cleaning' END::public.assignment_type,
    'assigned',2,CASE WHEN coalesce(v_room.is_checkout_room,false)
         THEN coalesce((v_room.pms_metadata->>'checkedOutToday')::boolean,false)
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
         r.guest_count, coalesce(r.is_checkout_room,false),
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
      OR (lower(coalesce(r.status,'')) IN ('dirty','unclean','needs_cleaning','needs cleaning','to_clean','checkout_dirty')
        AND (
          (r.pms_metadata->>'scheduledDepartureToday'='true'
            AND r.pms_metadata->>'pmsOccupancyStatus'='departing')
          OR (r.pms_metadata->>'pmsOccupancyStatus'='stayover'
            AND (coalesce(r.towel_change_required,false) OR coalesce(r.linen_change_required,false)))
        )
      )
    )
  ORDER BY coalesce(r.is_checkout_room,false) DESC, r.room_number;
END $function$;
