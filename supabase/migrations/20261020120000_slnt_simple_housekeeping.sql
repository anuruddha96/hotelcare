-- SLNT-only simplified housekeeping. This migration deliberately does not
-- change RD Hotels, shared assignment classifications or existing schedules.
-- SLNT Team B can be activated independently of Team A. Keep Team A off
-- until SLNT confirms staff and apartment membership in person.
CREATE TABLE IF NOT EXISTS public.slnt_housekeeping_rollout (
  organization_slug text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  team_a_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slnt_housekeeping_rollout_tenant CHECK (organization_slug = 'slnt')
);
ALTER TABLE public.slnt_housekeeping_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slnt_housekeeping_rollout FROM PUBLIC, anon, authenticated;
INSERT INTO public.slnt_housekeeping_rollout (organization_slug, enabled)
VALUES ('slnt', false) ON CONFLICT (organization_slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.slnt_simple_housekeeping_enabled(p_org text DEFAULT 'slnt')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_org = 'slnt'
     AND (current_setting('request.jwt.claim.role', true) = 'service_role'
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
                     AND p.organization_slug IN ('slnt','slnt-group')))
     AND EXISTS (SELECT 1 FROM public.slnt_housekeeping_rollout f
                 WHERE f.organization_slug='slnt' AND f.enabled)
     AND EXISTS (
       SELECT 1 FROM public.housekeeping_teams t
       WHERE t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
         AND EXISTS (SELECT 1 FROM public.housekeeping_team_rooms r
                     WHERE r.team_id=t.id AND r.is_active)
     );
$$;
REVOKE ALL ON FUNCTION public.slnt_simple_housekeeping_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_simple_housekeeping_enabled(text) TO authenticated, service_role;

-- Deferred Team A remains disabled even while Team B shared rooms are live.
CREATE OR REPLACE FUNCTION public.slnt_team_a_housekeeping_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.slnt_simple_housekeeping_enabled('slnt')
    AND EXISTS (SELECT 1 FROM public.slnt_housekeeping_rollout f
                WHERE f.organization_slug='slnt' AND f.team_a_enabled)
    AND EXISTS (
      SELECT 1 FROM public.housekeeping_teams t
      WHERE t.organization_slug='slnt' AND t.code='team-a' AND t.is_active
        AND EXISTS (SELECT 1 FROM public.housekeeping_team_rooms tr
                    WHERE tr.team_id=t.id AND tr.is_active)
        AND EXISTS (SELECT 1 FROM public.housekeeping_team_members tm
                    WHERE tm.team_id=t.id AND tm.is_active)
    );
$$;
REVOKE ALL ON FUNCTION public.slnt_team_a_housekeeping_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_a_housekeeping_enabled() TO authenticated, service_role;


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
  IF NOT public.slnt_team_a_housekeeping_enabled() THEN
    RAISE EXCEPTION 'SLNT Team A has not been configured or activated'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.slnt_team_b_claim_room(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_claim_room(uuid,date) TO authenticated;

-- Prevent housekeeping staff from approving their own Team B work via direct
-- PostgREST updates, even if their generic room-assignment permissions allow
-- changes to other fields. No changes to other tenants or Team A.
CREATE OR REPLACE FUNCTION public.slnt_team_b_protect_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.slnt_simple_housekeeping_enabled() THEN RETURN NEW; END IF;
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
  BEFORE UPDATE OF supervisor_approved, supervisor_approved_by, supervisor_approved_at
  ON public.room_assignments FOR EACH ROW
  WHEN (NEW.supervisor_approved IS DISTINCT FROM OLD.supervisor_approved
     OR NEW.supervisor_approved_by IS DISTINCT FROM OLD.supervisor_approved_by
     OR NEW.supervisor_approved_at IS DISTINCT FROM OLD.supervisor_approved_at)
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

-- Preserve existing future Team A Days Off during migration. Once imported,
-- SLNT managers edit only the simple days-off table, not daily shifts.
INSERT INTO public.slnt_team_a_days_off(team_id,user_id,work_date,created_by)
SELECT t.id,ss.user_id,ss.work_date,ss.created_by
FROM public.staff_schedules ss
JOIN public.housekeeping_teams t ON t.organization_slug='slnt'
  AND t.code='team-a' AND t.is_active
JOIN public.housekeeping_team_members tm ON tm.team_id=t.id
  AND tm.user_id=ss.user_id AND tm.is_active
WHERE ss.organization_slug IN ('slnt','slnt-group') AND ss.status='off'
  AND ss.work_date >= (now() AT TIME ZONE 'Europe/Budapest')::date
ON CONFLICT (team_id,user_id,work_date) DO NOTHING;

-- Override legacy Team B room auto-distribution only while shared-pool mode is active.
CREATE OR REPLACE FUNCTION public.finalize_slnt_team_b_after_full_pms_sync(p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'Europe/Budapest')::date;
  v_day_start timestamptz := (p_service_date::timestamp at time zone 'Europe/Budapest');
  v_team_id uuid;
  v_expected_accounts integer := 0;
  v_fresh_accounts integer := 0;
  v_staff_count integer := 0;
  v_staff_source text := 'saved_day_plan';
  v_cancelled integer := 0;
  v_type_changes integer := 0;
  v_candidate_repairs integer := 0;
  v_created integer := 0;
  v_linked integer := 0;
  v_task_id uuid;
  v_property text;
  v_owner uuid;
  v_preferred_owner uuid;
begin
  -- SLNT Team B operates as a shared claim pool when the rollout is active.
  -- Disabling legacy room auto-distribution preserves full existing room actions.
  IF public.slnt_simple_housekeeping_enabled('slnt') THEN
    RETURN jsonb_build_object('ok',true,'status','shared_pool_no_auto_assignment','service_date',p_service_date);
  END IF;
  if p_service_date is null or p_service_date <> v_today then
    raise exception 'SLNT Team B finalization is only allowed for the current Budapest business date.';
  end if;

  if auth.uid() is not null
     and not public.can_manage_next_day_housekeeping_plan('slnt','slnt-group') then
    raise exception 'Manager permission required' using errcode='42501';
  end if;

  select id into v_team_id
  from public.housekeeping_teams
  where organization_slug='slnt'
    and hotel_id='slnt-group'
    and code='team-b'
    and is_active
  limit 1;
  if v_team_id is null then
    raise exception 'Active SLNT Team B is not configured.';
  end if;

  select count(*)::integer,
         count(*) filter (where last_sync_success_at >= v_day_start)::integer
    into v_expected_accounts, v_fresh_accounts
  from public.pms_accounts
  where organization_slug='slnt'
    and hotel_id='slnt-group'
    and pms_type='previo'
    and is_active=true
    and coalesce(sync_paused,false)=false;

  if v_expected_accounts < 2 or v_fresh_accounts < v_expected_accounts then
    return jsonb_build_object(
      'ok', false,
      'status', 'held_for_full_pms_sync',
      'service_date', p_service_date,
      'expected_accounts', v_expected_accounts,
      'fresh_accounts', v_fresh_accounts
    );
  end if;

  select count(*)::integer into v_staff_count
  from public.housekeeping_team_day_staff
  where team_id=v_team_id and service_date=p_service_date;

  if v_staff_count=0 then
    insert into public.housekeeping_team_day_staff(team_id,service_date,user_id,selected_by)
    select v_team_id,p_service_date,m.user_id,null
    from public.housekeeping_team_members m
    join public.staff_schedules s
      on s.organization_slug='slnt'
     and s.user_id=m.user_id
     and s.work_date=p_service_date
     and s.status='published'
    join public.profiles p on p.id=m.user_id
    where m.team_id=v_team_id
      and m.is_active
      and p.deleted_at is null
      and p.organization_slug='slnt'
    on conflict(team_id,service_date,user_id) do nothing;
    get diagnostics v_staff_count = row_count;
    if v_staff_count>0 then v_staff_source := 'published_staff_schedule'; end if;
  end if;

  if not exists (
    select 1 from public.housekeeping_team_day_staff
    where team_id=v_team_id and service_date=p_service_date
  ) then
    insert into public.housekeeping_team_day_staff(team_id,service_date,user_id,selected_by)
    select v_team_id,p_service_date,m.user_id,null
    from public.housekeeping_team_members m
    join public.profiles p on p.id=m.user_id
    where m.team_id=v_team_id
      and m.is_active
      and (m.effective_from is null or m.effective_from<=p_service_date)
      and (m.effective_to is null or m.effective_to>=p_service_date)
      and p.deleted_at is null
      and p.organization_slug='slnt'
      and (p.role::text='housekeeping' or p.acts_as_housekeeper=true)
    on conflict(team_id,service_date,user_id) do nothing;
    v_staff_source := 'active_team_fallback';
  end if;

  select count(*)::integer into v_staff_count
  from public.housekeeping_team_day_staff
  where team_id=v_team_id and service_date=p_service_date;
  if v_staff_count=0 then
    return jsonb_build_object('ok',false,'status','held_no_working_staff','service_date',p_service_date);
  end if;

  update public.housekeeping_team_tasks t
  set status='cancelled', updated_at=now()
  from public.rooms r
  left join public.housekeeping_team_rooms tr
    on tr.team_id=v_team_id and tr.room_id=r.id and tr.is_active
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.room_id=r.id
    and t.status='queued'
    and t.claimed_by is null
    and (
      tr.room_id is null
      or r.status='out_of_order'
      or coalesce((r.pms_metadata->>'excludedFromHousekeeping')::boolean,false)
    );
  get diagnostics v_cancelled = row_count;

  update public.housekeeping_team_tasks t
  set assignment_type=case when coalesce(r.is_checkout_room,false)
      then 'checkout_cleaning'::public.assignment_type
      else 'daily_cleaning'::public.assignment_type end,
      updated_at=now()
  from public.rooms r
  join public.housekeeping_team_rooms tr
    on tr.team_id=v_team_id and tr.room_id=r.id and tr.is_active
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.room_id=r.id
    and t.status='queued'
    and t.claimed_by is null
    and r.status is distinct from 'out_of_order'
    and t.assignment_type is distinct from
      (case when coalesce(r.is_checkout_room,false)
        then 'checkout_cleaning'::public.assignment_type
        else 'daily_cleaning'::public.assignment_type end);
  get diagnostics v_type_changes = row_count;

  update public.housekeeping_team_tasks t
  set planned_candidate_user_id=null, updated_at=now()
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.status='queued'
    and t.claimed_by is null
    and t.planned_candidate_user_id is not null
    and not exists (
      select 1 from public.housekeeping_team_day_staff ds
      where ds.team_id=v_team_id
        and ds.service_date=p_service_date
        and ds.user_id=t.planned_candidate_user_id
    );
  get diagnostics v_candidate_repairs = row_count;

  -- Balance only unresolved rooms. Property preference is a tie-breaker, so a
  -- 20-room property may be split across staff instead of overloading one cleaner.
  for v_task_id, v_property in
    select t.id, public.slnt_team_b_property_key(r.room_number)
    from public.housekeeping_team_tasks t
    join public.rooms r on r.id=t.room_id
    where t.team_id=v_team_id
      and t.service_date=p_service_date
      and t.status='queued'
      and t.claimed_by is null
      and t.planned_candidate_user_id is null
    order by public.slnt_team_b_property_key(r.room_number),
             t.priority asc,
             coalesce(t.estimated_duration,30) desc,
             r.room_number
  loop
    v_preferred_owner := null;
    select pref.user_id into v_preferred_owner
    from public.housekeeping_team_property_preferences pref
    where pref.team_id=v_team_id
      and pref.property_key=v_property
      and exists (
        select 1 from public.housekeeping_team_day_staff ds
        where ds.team_id=v_team_id
          and ds.service_date=p_service_date
          and ds.user_id=pref.user_id
      )
    limit 1;

    select ds.user_id into v_owner
    from public.housekeeping_team_day_staff ds
    left join lateral (
      select coalesce(sum(coalesce(t3.estimated_duration,30)),0)::integer as load_minutes
      from public.housekeeping_team_tasks t3
      where t3.team_id=v_team_id
        and t3.service_date=p_service_date
        and t3.status<>'cancelled'
        and t3.planned_candidate_user_id=ds.user_id
    ) load on true
    where ds.team_id=v_team_id and ds.service_date=p_service_date
    order by load.load_minutes asc,
             case when ds.user_id=v_preferred_owner then 0 else 1 end,
             ds.user_id
    limit 1;

    if v_owner is not null then
      update public.housekeeping_team_tasks
      set planned_candidate_user_id=v_owner, updated_at=now()
      where id=v_task_id
        and status='queued'
        and claimed_by is null
        and planned_candidate_user_id is null;
    end if;
  end loop;

  insert into public.room_assignments(
    room_id,assigned_to,assigned_by,assignment_date,assignment_type,status,
    priority,estimated_duration,notes,organization_slug,ready_to_clean
  )
  select
    t.room_id,
    t.planned_candidate_user_id,
    t.planned_candidate_user_id,
    t.service_date,
    t.assignment_type,
    'assigned'::public.assignment_status,
    t.priority,
    t.estimated_duration,
    case when coalesce(t.notes,'')=''
      then 'Auto-distributed after full SLNT PMS sync.'
      else t.notes end,
    'slnt',
    case when t.assignment_type='checkout_cleaning'::public.assignment_type
      then coalesce((r.pms_metadata->>'checkedOutToday')::boolean,false)
      else true end
  from public.housekeeping_team_tasks t
  join public.rooms r on r.id=t.room_id
  join public.housekeeping_team_rooms tr
    on tr.team_id=v_team_id and tr.room_id=t.room_id and tr.is_active
  join public.housekeeping_team_day_staff ds
    on ds.team_id=v_team_id
   and ds.service_date=t.service_date
   and ds.user_id=t.planned_candidate_user_id
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.status='queued'
    and t.claimed_by is null
    and t.planned_candidate_user_id is not null
    and r.status is distinct from 'out_of_order'
    and not exists (
      select 1 from public.room_assignments ra
      where ra.room_id=t.room_id
        and ra.assignment_date=t.service_date
        and ra.status<>'cancelled'::public.assignment_status
    );
  get diagnostics v_created = row_count;

  update public.housekeeping_team_tasks t
  set status='claimed',
      claimed_by=t.planned_candidate_user_id,
      claimed_at=coalesce(t.claimed_at,now()),
      room_assignment_id=ra.id,
      updated_at=now()
  from public.room_assignments ra
  where t.team_id=v_team_id
    and t.service_date=p_service_date
    and t.status='queued'
    and t.planned_candidate_user_id is not null
    and ra.room_id=t.room_id
    and ra.assignment_date=t.service_date
    and ra.assigned_to=t.planned_candidate_user_id
    and ra.status<>'cancelled'::public.assignment_status;
  get diagnostics v_linked = row_count;

  return jsonb_build_object(
    'ok',true,
    'status','distributed',
    'service_date',p_service_date,
    'staff_source',v_staff_source,
    'staff_count',v_staff_count,
    'inactive_tasks_cancelled',v_cancelled,
    'service_type_changes',v_type_changes,
    'invalid_candidate_repairs',v_candidate_repairs,
    'assignments_created',v_created,
    'tasks_materialized',v_linked,
    'remaining_unassigned',(
      select count(*) from public.housekeeping_team_tasks
      where team_id=v_team_id and service_date=p_service_date and status='queued'
    )
  );
end;
$function$;


-- Override legacy Team B room auto-distribution only while shared-pool mode is active.
CREATE OR REPLACE FUNCTION public.materialize_slnt_team_b_planned_assignments(p_service_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id uuid;
  v_actor uuid := auth.uid();
  v_created integer := 0;
  v_linked integer := 0;
begin
  -- SLNT Team B operates as a shared claim pool when the rollout is active.
  -- Disabling legacy room auto-distribution preserves full existing room actions.
  IF public.slnt_simple_housekeeping_enabled('slnt') THEN
    RETURN jsonb_build_object('ok',true,'status','shared_pool_no_auto_assignment','service_date',p_service_date);
  END IF;
  if v_actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.can_manage_next_day_housekeeping_plan('slnt','slnt-group') then
    raise exception 'Manager permission required' using errcode='42501';
  end if;

  select id into v_team_id from public.housekeeping_teams
   where organization_slug='slnt' and hotel_id='slnt-group' and code='team-b' and is_active limit 1;
  if v_team_id is null then raise exception 'Active SLNT Team B is not configured'; end if;

  -- Only materialize a planned cleaner who is actually selected for this day.
  insert into public.room_assignments (
    room_id, assigned_to, assigned_by, assignment_date, assignment_type,
    status, priority, estimated_duration, notes, organization_slug
  )
  select t.room_id, t.planned_candidate_user_id, v_actor, t.service_date,
         t.assignment_type, 'assigned'::public.assignment_status, t.priority,
         t.estimated_duration, t.notes, 'slnt'
  from public.housekeeping_team_tasks t
  join public.housekeeping_team_day_staff ds
    on ds.team_id=t.team_id and ds.service_date=t.service_date
   and ds.user_id=t.planned_candidate_user_id
  join public.rooms r on r.id=t.room_id
  where t.team_id=v_team_id and t.service_date=p_service_date
    and t.status='queued' and t.claimed_by is null
    and t.planned_candidate_user_id is not null
    and r.organization_slug='slnt' and r.status is distinct from 'out_of_order'
    and not exists (
      select 1 from public.room_assignments ra
       where ra.room_id=t.room_id and ra.assignment_date=t.service_date
         and ra.status <> 'cancelled'::public.assignment_status
    );
  get diagnostics v_created = row_count;

  update public.housekeeping_team_tasks t
     set status='claimed',
         claimed_by=t.planned_candidate_user_id,
         claimed_at=coalesce(t.claimed_at,now()),
         room_assignment_id=ra.id,
         updated_at=now()
    from public.room_assignments ra
   where t.team_id=v_team_id and t.service_date=p_service_date
     and t.status='queued' and t.planned_candidate_user_id is not null
     and ra.room_id=t.room_id and ra.assignment_date=t.service_date
     and ra.assigned_to=t.planned_candidate_user_id
     and ra.status <> 'cancelled'::public.assignment_status;
  get diagnostics v_linked = row_count;

  return jsonb_build_object(
    'service_date',p_service_date,
    'assignments_created',v_created,
    'tasks_materialized',v_linked,
    'unassigned_count',(select count(*) from public.housekeeping_team_tasks
      where team_id=v_team_id and service_date=p_service_date and status='queued')
  );
end;
$function$;

