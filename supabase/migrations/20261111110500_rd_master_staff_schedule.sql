-- RD Hotels master scheduler: organization-wide executive/HR access,
-- property-scoped managers, self-only published rosters for employees.
-- This migration deliberately does not touch SLNT schedule policies.
--
-- Historical records remain readable to authorized managers, but a schedule
-- dated before the current Budapest business date is not editable in the UI
-- or by the authenticated Data API. Payroll adjustments use attendance.
--
-- Overnight shift support: 20:00-08:00 is valid; equal clock times are not.
ALTER TABLE public.staff_schedules
  DROP CONSTRAINT IF EXISTS staff_schedules_shift_valid;
ALTER TABLE public.staff_schedules
  ADD CONSTRAINT staff_schedules_shift_valid
  CHECK (
    (shift_start IS NULL AND shift_end IS NULL)
    OR (shift_start IS NOT NULL AND shift_end IS NOT NULL AND shift_start <> shift_end)
  );

ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedule_venues ENABLE ROW LEVEL SECURITY;

-- All policies check the authenticated account's server-side profile role.
-- Employee rows are checked against the same organization and base hotel.
CREATE POLICY "RD schedule authorized reads"
ON public.staff_schedules FOR SELECT TO authenticated
USING (
  organization_slug = 'rdhotels'
  AND public.get_user_organization_slug((select auth.uid())) = 'rdhotels'
  AND (
    (
      public.get_user_role((select auth.uid()))::text IN
        ('admin', 'top_management', 'top_management_manager', 'hr')
    )
    OR (
      public.get_user_role((select auth.uid()))::text IN ('manager', 'housekeeping_manager')
      AND (
        hotel_id = public.get_user_assigned_hotel((select auth.uid()))
        OR EXISTS (
          SELECT 1
          FROM public.hotel_configurations h
          JOIN public.organizations o ON o.id = h.organization_id
          WHERE o.slug = 'rdhotels'
            AND h.hotel_id = staff_schedules.hotel_id
            AND h.hotel_name = public.get_user_assigned_hotel((select auth.uid()))
        )
      )
    )
    OR (user_id = (select auth.uid()) AND status = 'published')
  )
);

CREATE POLICY "RD schedule authorized creates"
ON public.staff_schedules FOR INSERT TO authenticated
WITH CHECK (
  organization_slug = 'rdhotels'
  AND work_date >= (timezone('Europe/Budapest',now()))::date
  AND created_by = (select auth.uid())
  AND public.get_user_organization_slug((select auth.uid())) = 'rdhotels'
  AND (
    public.get_user_role((select auth.uid()))::text IN
      ('admin', 'top_management', 'top_management_manager', 'hr')
    OR (
      public.get_user_role((select auth.uid()))::text IN ('manager', 'housekeeping_manager')
      AND (
        hotel_id = public.get_user_assigned_hotel((select auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.hotel_configurations h
          JOIN public.organizations o ON o.id = h.organization_id
          WHERE o.slug = 'rdhotels' AND h.hotel_id = staff_schedules.hotel_id
            AND h.hotel_name = public.get_user_assigned_hotel((select auth.uid()))
        )
      )
    )
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles employee
    WHERE employee.id = staff_schedules.user_id
      AND employee.organization_slug = 'rdhotels'
      AND employee.deleted_at IS NULL
      AND (
        employee.assigned_hotel = staff_schedules.hotel_id
        OR EXISTS (
          SELECT 1 FROM public.hotel_configurations h
          JOIN public.organizations o ON o.id = h.organization_id
          WHERE o.slug = 'rdhotels'
            AND h.hotel_id = staff_schedules.hotel_id
            AND h.hotel_name = employee.assigned_hotel
        )
      )
  )
);

CREATE POLICY "RD schedule authorized edits"
ON public.staff_schedules FOR UPDATE TO authenticated
USING (
  organization_slug = 'rdhotels'
  AND work_date >= (timezone('Europe/Budapest',now()))::date
  AND public.get_user_organization_slug((select auth.uid())) = 'rdhotels'
  AND (
    public.get_user_role((select auth.uid()))::text IN
      ('admin', 'top_management', 'top_management_manager', 'hr')
    OR (
      public.get_user_role((select auth.uid()))::text IN ('manager','housekeeping_manager')
      AND (
        hotel_id = public.get_user_assigned_hotel((select auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.hotel_configurations h
          JOIN public.organizations o ON o.id = h.organization_id
          WHERE o.slug = 'rdhotels' AND h.hotel_id = staff_schedules.hotel_id
            AND h.hotel_name = public.get_user_assigned_hotel((select auth.uid()))
        )
      )
    )
  )
)
WITH CHECK (
  organization_slug = 'rdhotels'
  AND work_date >= (timezone('Europe/Budapest',now()))::date
  AND public.get_user_organization_slug((select auth.uid())) = 'rdhotels'
  AND (
    public.get_user_role((select auth.uid()))::text IN
      ('admin', 'top_management', 'top_management_manager', 'hr')
    OR (
      public.get_user_role((select auth.uid()))::text IN ('manager','housekeeping_manager')
      AND (
        hotel_id = public.get_user_assigned_hotel((select auth.uid()))
        OR EXISTS (
          SELECT 1 FROM public.hotel_configurations h
          JOIN public.organizations o ON o.id = h.organization_id
          WHERE o.slug = 'rdhotels' AND h.hotel_id = staff_schedules.hotel_id
            AND h.hotel_name = public.get_user_assigned_hotel((select auth.uid()))
        )
      )
    )
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles employee
    WHERE employee.id = staff_schedules.user_id
      AND employee.organization_slug = 'rdhotels' AND employee.deleted_at IS NULL
      AND (
        employee.assigned_hotel = staff_schedules.hotel_id
        OR EXISTS (
          SELECT 1 FROM public.hotel_configurations h
          JOIN public.organizations o ON o.id = h.organization_id
          WHERE o.slug = 'rdhotels' AND h.hotel_id = staff_schedules.hotel_id
            AND h.hotel_name = employee.assigned_hotel
        )
      )
  )
);

-- Venue links inherit the schedule's row visibility. Existing SLNT policies
-- remain independent; joins across different organizations are rejected.
CREATE POLICY "RD schedule venue reads"
ON public.staff_schedule_venues FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_schedules s
    WHERE s.id = staff_schedule_venues.schedule_id
      AND s.organization_slug = 'rdhotels'
  )
);

CREATE POLICY "RD schedule venue creates"
ON public.staff_schedule_venues FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.staff_schedules s
    JOIN public.venues v ON v.id = staff_schedule_venues.venue_id
    WHERE s.id = staff_schedule_venues.schedule_id
      AND s.organization_slug = 'rdhotels' AND v.organization_slug = 'rdhotels'
      AND s.work_date >= (timezone('Europe/Budapest',now()))::date
      AND (
        public.get_user_role((select auth.uid()))::text IN
          ('admin','hr','top_management','top_management_manager')
        OR (
          public.get_user_role((select auth.uid()))::text IN
            ('manager','housekeeping_manager')
          AND (
            s.hotel_id = public.get_user_assigned_hotel((select auth.uid()))
            OR EXISTS (
              SELECT 1 FROM public.hotel_configurations h
              JOIN public.organizations o ON o.id = h.organization_id
              WHERE o.slug='rdhotels' AND h.hotel_id = s.hotel_id
                AND h.hotel_name = public.get_user_assigned_hotel((select auth.uid()))
            )
          )
        )
      )
  )
);
CREATE POLICY "RD schedule venue deletes"
ON public.staff_schedule_venues FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.staff_schedules s
    WHERE s.id = staff_schedule_venues.schedule_id
      AND s.organization_slug = 'rdhotels'
      AND s.work_date >= (timezone('Europe/Budapest',now()))::date
      AND (
        public.get_user_role((select auth.uid()))::text IN
          ('admin','hr','top_management','top_management_manager')
        OR (
          public.get_user_role((select auth.uid()))::text IN
            ('manager','housekeeping_manager')
          AND (
            s.hotel_id = public.get_user_assigned_hotel((select auth.uid()))
            OR EXISTS (
              SELECT 1 FROM public.hotel_configurations h
              JOIN public.organizations o ON o.id = h.organization_id
              WHERE o.slug='rdhotels' AND h.hotel_id = s.hotel_id
                AND h.hotel_name = public.get_user_assigned_hotel((select auth.uid()))
            )
          )
        )
      )
  )
);


-- Job title is an HR position label, not an authorization role.
-- This narrow, audited RPC changes only profiles.job_title; it never grants
-- access by altering role/is_super_admin/organization_slug.
CREATE TABLE IF NOT EXISTS public.rd_staff_position_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.profiles(id),
  editor_id uuid NOT NULL REFERENCES public.profiles(id),
  old_position text,
  new_position text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rd_staff_position_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "RD HR and executives view position history"
ON public.rd_staff_position_history FOR SELECT TO authenticated
USING (
  public.get_user_organization_slug((select auth.uid())) = 'rdhotels'
  AND public.get_user_role((select auth.uid()))::text IN
    ('admin','top_management','top_management_manager','hr')
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = employee_id AND p.organization_slug = 'rdhotels'
  )
);

CREATE FUNCTION public.rd_set_staff_position(_employee_id uuid, _position text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE
  actor public.profiles%ROWTYPE;
  employee public.profiles%ROWTYPE;
  normalized_position text;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO employee FROM public.profiles WHERE id = _employee_id FOR UPDATE;
  IF actor.id IS NULL OR actor.deleted_at IS NOT NULL
     OR employee.id IS NULL OR employee.deleted_at IS NOT NULL
     OR actor.organization_slug IS DISTINCT FROM 'rdhotels'
     OR employee.organization_slug IS DISTINCT FROM 'rdhotels'
     OR actor.role::text NOT IN ('admin','top_management','top_management_manager','hr','manager','housekeeping_manager') THEN
    RAISE EXCEPTION 'Not authorized to update staff position';
  END IF;
  IF actor.role::text IN ('manager','housekeeping_manager') AND NOT EXISTS (
    SELECT 1 FROM public.hotel_configurations h
    JOIN public.organizations o ON o.id = h.organization_id
    WHERE o.slug = 'rdhotels'
      AND actor.assigned_hotel IN (h.hotel_id, h.hotel_name)
      AND employee.assigned_hotel IN (h.hotel_id, h.hotel_name)
  ) THEN
    RAISE EXCEPTION 'Position belongs to another property';
  END IF;
  normalized_position := nullif(btrim(_position), '');
  IF length(coalesce(normalized_position,'')) > 120 THEN
    RAISE EXCEPTION 'Position title cannot exceed 120 characters';
  END IF;
  IF employee.job_title IS DISTINCT FROM normalized_position THEN
    UPDATE public.profiles SET job_title = normalized_position, updated_at = now()
    WHERE id = _employee_id;
    INSERT INTO public.rd_staff_position_history (employee_id, editor_id, old_position, new_position)
    VALUES (_employee_id, auth.uid(), employee.job_title, normalized_position);
  END IF;
END;
$body$;
REVOKE ALL ON FUNCTION public.rd_set_staff_position(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rd_set_staff_position(uuid,text) TO authenticated;
