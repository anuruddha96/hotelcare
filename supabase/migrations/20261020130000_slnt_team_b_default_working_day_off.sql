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
