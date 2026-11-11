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
