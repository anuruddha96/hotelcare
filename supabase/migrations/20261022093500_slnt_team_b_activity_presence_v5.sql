-- SLNT Team B only: activity-informed operational availability.
-- Preserve manager-authored days off, official staff schedules and assignments.
-- "Inactive" describes app activity, NOT physical attendance/absence.
CREATE TABLE IF NOT EXISTS public.slnt_team_b_activity_v5 (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  first_activity_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_date)
);

ALTER TABLE public.slnt_team_b_activity_v5 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.slnt_team_b_activity_v5 FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS slnt_team_b_activity_v5_recent_idx
  ON public.slnt_team_b_activity_v5(work_date, last_activity_at DESC);

-- A cleaner can only heartbeat themselves, in SLNT, today, while an active
-- Team B member. A manager's explicit leave/off decision is never overridden.
CREATE OR REPLACE FUNCTION public.slnt_team_b_touch_activity_v5()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_date date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF NOT public.slnt_simple_housekeeping_enabled('slnt') OR NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.housekeeping_team_members m ON m.user_id=p.id AND m.is_active
      AND (m.effective_from IS NULL OR m.effective_from<=v_date)
      AND (m.effective_to IS NULL OR m.effective_to>=v_date)
    JOIN public.housekeeping_teams t ON t.id=m.team_id
      AND t.organization_slug='slnt' AND t.code='team-b' AND t.is_active
    WHERE p.id=auth.uid() AND p.organization_slug IN ('slnt','slnt-group')
      AND p.role::text='housekeeping' AND p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.slnt_team_b_days_off d
        WHERE d.team_id=t.id AND d.user_id=p.id AND d.work_date=v_date
      )
  ) THEN RAISE EXCEPTION 'Active SLNT Team B housekeeper required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.slnt_team_b_activity_v5(user_id, work_date, first_activity_at, last_activity_at)
  VALUES(auth.uid(), v_date, now(), now())
  ON CONFLICT(user_id, work_date) DO UPDATE SET last_activity_at=now();
END $$;
REVOKE ALL ON FUNCTION public.slnt_team_b_touch_activity_v5() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_touch_activity_v5() TO authenticated;

-- The calendar gives managers a live operational status without changing
-- published shifts or marking workers sick/on leave based on lack of taps.
-- Clients re-activate automatically when they return to the worklist.
CREATE OR REPLACE FUNCTION public.slnt_team_b_calendar_v5(p_start date,p_end date)
RETURNS TABLE(
  work_date date, user_id uuid, staff_name text, is_working boolean,
  absence_kind text, activity_state text, last_activity_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT c.work_date,c.user_id,c.staff_name,c.is_working,c.absence_kind,
    CASE
      WHEN NOT c.is_working THEN 'off'
      WHEN c.work_date > (now() AT TIME ZONE 'Europe/Budapest')::date THEN 'planned'
      WHEN c.work_date < (now() AT TIME ZONE 'Europe/Budapest')::date THEN 'historical'
      WHEN a.user_id IS NULL THEN 'not_online'
      WHEN a.last_activity_at < now() - interval '3 hours' THEN 'inactive'
      ELSE 'active'
    END::text AS activity_state,
    a.last_activity_at
  FROM public.slnt_team_b_calendar_v4(p_start,p_end) c
  LEFT JOIN public.slnt_team_b_activity_v5 a
    ON a.user_id=c.user_id AND a.work_date=c.work_date
  ORDER BY c.staff_name,c.work_date
$$;
REVOKE ALL ON FUNCTION public.slnt_team_b_calendar_v5(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.slnt_team_b_calendar_v5(date,date) TO authenticated;

COMMENT ON FUNCTION public.slnt_team_b_calendar_v5(date,date) IS
  'SLNT Team B planned days and automatically computed HotelCare activity state; three-hour inactivity never overwrites approved leave, physical attendance or in-progress room ownership.';
