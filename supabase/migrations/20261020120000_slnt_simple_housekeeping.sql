-- SLNT-only simplified housekeeping. This migration deliberately does not
-- change RD Hotels, shared assignment classifications or existing schedules.
CREATE TABLE IF NOT EXISTS public.slnt_team_a_days_off (
  team_id uuid NOT NULL REFERENCES public.housekeeping_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id, work_date)
);
ALTER TABLE public.slnt_team_a_days_off ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slnt_team_a_days_off FROM anon, authenticated;
GRANT SELECT ON public.slnt_team_a_days_off TO authenticated;

DROP POLICY IF EXISTS slnt_team_a_days_off_read ON public.slnt_team_a_days_off;
CREATE POLICY slnt_team_a_days_off_read ON public.slnt_team_a_days_off
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.housekeeping_teams t
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.id = team_id AND t.organization_slug = 'slnt'
      AND t.code = 'team-a' AND t.is_active
      AND p.organization_slug IN ('slnt','slnt-group')
      AND p.role IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
  )
);

CREATE OR REPLACE FUNCTION public.slnt_set_team_a_day_off(
  p_team_id uuid, p_user_id uuid, p_work_date date, p_is_off boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.housekeeping_teams t ON t.organization_slug = 'slnt'
    JOIN public.housekeeping_team_members m ON m.team_id = t.id AND m.user_id = p_user_id AND m.is_active
    WHERE p.id = auth.uid() AND p.organization_slug IN ('slnt','slnt-group')
      AND p.role IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
      AND t.id = p_team_id AND t.code = 'team-a' AND t.is_active
  ) THEN RAISE EXCEPTION 'SLNT Team A manager access required' USING ERRCODE = '42501'; END IF;
  IF p_work_date < (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Cannot change past Team A availability';
  END IF;
  IF p_is_off THEN
    IF EXISTS (
      SELECT 1 FROM public.room_assignments a
      JOIN public.housekeeping_team_rooms tr ON tr.room_id = a.room_id AND tr.team_id = p_team_id AND tr.is_active
      WHERE a.assigned_to = p_user_id AND a.assignment_date = p_work_date
        AND a.status IN ('assigned','in_progress','completed')
    ) THEN
      RAISE EXCEPTION 'Reassign this cleaner''s rooms before marking the day off';
    END IF;
    INSERT INTO public.slnt_team_a_days_off(team_id,user_id,work_date,created_by)
    VALUES (p_team_id,p_user_id,p_work_date,auth.uid())
    ON CONFLICT (team_id,user_id,work_date) DO NOTHING;
  ELSE
    DELETE FROM public.slnt_team_a_days_off
    WHERE team_id = p_team_id AND user_id = p_user_id AND work_date = p_work_date;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.slnt_set_team_a_day_off(uuid,uuid,date,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_set_team_a_day_off(uuid,uuid,date,boolean) TO authenticated;

-- The shared queue is server-scoped to SLNT Team B, not a client-side
-- organization filter. Room identity is the active team-room mapping.
CREATE OR REPLACE FUNCTION public.slnt_team_b_worklist(p_service_date date)
RETURNS TABLE(
  room_id uuid, room_number text, room_status text, room_name text,
  notes text, guest_count integer, is_checkout_room boolean,
  towel_change_required boolean, linen_change_required boolean,
  pms_metadata jsonb, assignment_id uuid, assigned_to uuid,
  assignment_status text, supervisor_approved boolean
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_team_id uuid;
BEGIN
  IF p_service_date <> (now() AT TIME ZONE 'Europe/Budapest')::date THEN
    RAISE EXCEPTION 'Team B shared worklist is available for today only';
  END IF;
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
    AND lower(coalesce(r.status,'')) NOT IN ('out_of_order','out_of_service','blocked','maintenance')
    AND (
      a.id IS NOT NULL
      OR lower(coalesce(r.status,'')) IN ('dirty','unclean','needs_cleaning','needs cleaning','to_clean','checkout_dirty')
      OR coalesce(r.is_checkout_room,false)
      OR coalesce(r.towel_change_required,false)
      OR coalesce(r.linen_change_required,false)
    )
  ORDER BY coalesce(r.is_checkout_room,false) DESC, r.room_number;
END $$;
REVOKE ALL ON FUNCTION public.slnt_team_b_worklist(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_worklist(date) TO authenticated;

-- Lock the physical room to prevent two housekeepers claiming the same work.
-- The existing room assignment + supervisor approval/photo workflow is reused.
CREATE OR REPLACE FUNCTION public.slnt_team_b_claim_room(p_room_id uuid,p_service_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_team_id uuid; v_org_slug text; v_room public.rooms%ROWTYPE;
        v_assignment public.room_assignments%ROWTYPE;
BEGIN
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
  SELECT r.* INTO v_room FROM public.rooms r
    JOIN public.housekeeping_team_rooms tr ON tr.room_id=r.id AND tr.team_id=v_team_id AND tr.is_active
    WHERE r.id=p_room_id AND r.organization_slug IN ('slnt','slnt-group')
    FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room is not assigned to SLNT Team B'; END IF;
  IF lower(coalesce(v_room.status,'')) IN ('clean','cleaned','ready','out_of_order','out_of_service','blocked','maintenance') THEN
    RAISE EXCEPTION 'Room is already clean or unavailable';
  END IF;
  IF NOT (
    lower(coalesce(v_room.status,'')) IN ('dirty','unclean','needs_cleaning','needs cleaning','to_clean','checkout_dirty')
    OR coalesce(v_room.is_checkout_room,false)
    OR coalesce(v_room.towel_change_required,false)
    OR coalesce(v_room.linen_change_required,false)
  ) THEN RAISE EXCEPTION 'Room has no confirmed housekeeping task today'; END IF;

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
    'assigned',2,NOT coalesce(v_room.is_checkout_room,false),false
  ) RETURNING id INTO v_assignment.id;
  RETURN v_assignment.id;
END $$;
REVOKE ALL ON FUNCTION public.slnt_team_b_claim_room(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_claim_room(uuid,date) TO authenticated;

-- Prevent housekeeping staff from approving their own Team B work via direct
-- PostgREST updates, even if their generic room-assignment permissions allow
-- changes to other fields. No changes to other tenants or Team A.
CREATE OR REPLACE FUNCTION public.slnt_team_b_protect_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (NEW.supervisor_approved IS DISTINCT FROM OLD.supervisor_approved
      OR NEW.supervisor_approved_by IS DISTINCT FROM OLD.supervisor_approved_by
      OR NEW.supervisor_approved_at IS DISTINCT FROM OLD.supervisor_approved_at)
     AND EXISTS (
       SELECT 1 FROM public.housekeeping_team_rooms tr
       JOIN public.housekeeping_teams t ON t.id=tr.team_id
       WHERE tr.room_id=OLD.room_id AND tr.is_active AND t.code='team-b'
         AND t.organization_slug='slnt' AND t.is_active
     ) AND current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
        AND p.organization_slug IN ('slnt','slnt-group')
        AND p.role IN ('admin','manager','housekeeping_manager','top_management','top_management_manager')
    ) THEN RAISE EXCEPTION 'Only SLNT management may approve Team B work' USING ERRCODE='42501'; END IF;
    IF NEW.supervisor_approved AND NEW.status <> 'completed' THEN
      RAISE EXCEPTION 'Team B work must be completed before manager approval';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS slnt_team_b_protect_approval ON public.room_assignments;
CREATE TRIGGER slnt_team_b_protect_approval
  BEFORE UPDATE ON public.room_assignments FOR EACH ROW
  EXECUTE FUNCTION public.slnt_team_b_protect_approval();

-- Safe membership probe for routing each cleaner to the correct SLNT UI.
CREATE OR REPLACE FUNCTION public.slnt_is_team_b_member()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.housekeeping_team_members m
    JOIN public.housekeeping_teams t ON t.id=m.team_id
    JOIN public.profiles p ON p.id=m.user_id
    WHERE m.user_id=auth.uid() AND m.is_active
      AND t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
      AND p.organization_slug IN ('slnt','slnt-group')
      AND (m.effective_from IS NULL OR m.effective_from <= (now() AT TIME ZONE 'Europe/Budapest')::date)
      AND (m.effective_to IS NULL OR m.effective_to >= (now() AT TIME ZONE 'Europe/Budapest')::date)
  );
$$;
REVOKE ALL ON FUNCTION public.slnt_is_team_b_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_is_team_b_member() TO authenticated;
