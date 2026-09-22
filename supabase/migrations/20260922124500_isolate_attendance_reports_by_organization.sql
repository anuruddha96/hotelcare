-- Organization boundary for attendance is enforced in the database, not in UI filters.
-- Keep normal cross-property reporting within a company; never cross between companies.
CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(
  target_user_id uuid DEFAULT NULL::uuid,
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(id uuid, user_id uuid, check_in_time timestamptz, check_out_time timestamptz,
  check_in_location jsonb, check_out_location jsonb, work_date date, total_hours numeric,
  break_duration integer, status text, notes text, full_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
         sa.check_in_location, sa.check_out_location, sa.work_date,
         sa.total_hours, sa.break_duration, sa.status, sa.notes,
         employee.full_name, employee.role::text
  FROM public.staff_attendance sa
  JOIN public.profiles employee ON employee.id = sa.user_id
  JOIN public.profiles caller ON caller.id = auth.uid()
  WHERE caller.deleted_at IS NULL
    AND caller.organization_slug IS NOT NULL
    AND employee.deleted_at IS NULL
    AND employee.organization_slug = caller.organization_slug
    AND sa.organization_slug = caller.organization_slug
    AND (target_user_id IS NULL OR sa.user_id = target_user_id)
    AND sa.work_date BETWEEN start_date AND end_date
    AND (
      sa.user_id = auth.uid()
      OR caller.role::text IN ('admin', 'hr', 'top_management', 'top_management_manager')
      OR (
        caller.role::text IN ('manager', 'housekeeping_manager')
        AND caller.assigned_hotel IS NOT NULL
        AND (
          employee.assigned_hotel = caller.assigned_hotel
          OR employee.assigned_hotel = public.get_hotel_name_from_id(caller.assigned_hotel)
          OR public.get_hotel_name_from_id(employee.assigned_hotel) = caller.assigned_hotel
        )
      )
    )
  ORDER BY sa.work_date DESC, sa.check_in_time DESC;
$fn$;

CREATE OR REPLACE FUNCTION public.get_attendance_summary_secure(
  target_user_id uuid DEFAULT NULL::uuid,
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT json_build_object(
    'total_days', COUNT(DISTINCT a.work_date),
    'total_hours', COALESCE(SUM(a.total_hours), 0),
    'avg_hours_per_day', COALESCE(SUM(a.total_hours) / NULLIF(COUNT(DISTINCT a.work_date), 0), 0),
    'punctual_days', COUNT(*) FILTER (WHERE a.check_in_time::time <= '09:00:00'),
    'late_arrivals', COUNT(*) FILTER (WHERE a.check_in_time::time > '09:00:00'),
    'early_departures', COUNT(*) FILTER (WHERE a.check_out_time::time < '17:00:00' AND a.check_out_time IS NOT NULL)
  )
  FROM public.get_attendance_records_hotel_filtered(target_user_id, start_date, end_date) a;
$fn$;

-- Older functions cannot be used as bypasses.
CREATE OR REPLACE FUNCTION public.get_attendance_records_secure(
  target_user_id uuid DEFAULT NULL::uuid,
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(id uuid, user_id uuid, check_in_time timestamptz, check_out_time timestamptz,
  check_in_location jsonb, check_out_location jsonb, work_date date, total_hours numeric,
  break_duration integer, status text, notes text, full_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT * FROM public.get_attendance_records_hotel_filtered(target_user_id, start_date, end_date);
$fn$;

CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  target_user_id uuid DEFAULT NULL::uuid,
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT json_build_object(
    'total_days', COUNT(DISTINCT a.work_date),
    'total_hours', COALESCE(SUM(a.total_hours), 0),
    'avg_hours_per_day', COALESCE(AVG(a.total_hours), 0),
    'punctual_days', COUNT(*) FILTER (WHERE a.check_in_time::time <= '09:00:00'),
    'late_arrivals', COUNT(*) FILTER (WHERE a.check_in_time::time > '09:00:00'),
    'early_departures', COUNT(*) FILTER (WHERE a.check_out_time::time < '17:00:00' AND a.check_out_time IS NOT NULL)
  )
  FROM public.get_attendance_records_hotel_filtered(target_user_id, start_date, end_date) a
  WHERE a.check_out_time IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.get_employees_by_hotel()
RETURNS TABLE(id uuid, full_name text, role public.user_role, assigned_hotel text,
  email text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $fn$
  SELECT employee.id, employee.full_name, employee.role, employee.assigned_hotel,
         employee.email, employee.created_at
  FROM public.profiles employee
  JOIN public.profiles caller ON caller.id = auth.uid()
  WHERE caller.deleted_at IS NULL
    AND caller.organization_slug IS NOT NULL
    AND employee.organization_slug = caller.organization_slug
    AND employee.deleted_at IS NULL
    AND (
      (caller.role::text IN ('admin', 'hr', 'top_management', 'top_management_manager')
       AND employee.role::text <> 'admin')
      OR (caller.assigned_hotel IS NOT NULL
        AND employee.role::text IN ('housekeeping', 'reception', 'maintenance', 'marketing',
          'control_finance', 'front_office', 'manager', 'housekeeping_manager')
        AND (
          employee.assigned_hotel = caller.assigned_hotel
          OR employee.assigned_hotel = public.get_hotel_name_from_id(caller.assigned_hotel)
          OR public.get_hotel_name_from_id(employee.assigned_hotel) = caller.assigned_hotel
        ))
    )
  ORDER BY employee.full_name;
$fn$;

-- RLS protects direct table access; the SECURITY DEFINER functions above implement their own filter.
DROP POLICY IF EXISTS "Users can view all their own attendance records" ON public.staff_attendance;
CREATE POLICY "Users can view all their own attendance records" ON public.staff_attendance
FOR SELECT TO authenticated USING (
  organization_slug IS NOT NULL
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.profiles employee
    WHERE employee.id = staff_attendance.user_id
      AND employee.deleted_at IS NULL
      AND employee.organization_slug = staff_attendance.organization_slug
      AND (
        staff_attendance.user_id = auth.uid()
        OR public.get_user_role(auth.uid())::text IN ('admin','hr','top_management','top_management_manager')
        OR (public.get_user_role(auth.uid())::text IN ('manager','housekeeping_manager')
            AND employee.assigned_hotel IS NOT NULL
            AND (employee.assigned_hotel = public.get_user_assigned_hotel(auth.uid())
              OR employee.assigned_hotel = public.get_hotel_name_from_id(public.get_user_assigned_hotel(auth.uid()))
              OR public.get_hotel_name_from_id(employee.assigned_hotel) = public.get_user_assigned_hotel(auth.uid())))
      )
  )
);

DROP POLICY IF EXISTS "tm_hk_select_staff_attendance" ON public.staff_attendance;
CREATE POLICY "tm_hk_select_staff_attendance" ON public.staff_attendance
FOR SELECT TO authenticated USING (
  public.is_top_management(auth.uid())
  AND organization_slug IS NOT NULL
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND EXISTS (SELECT 1 FROM public.profiles employee
              WHERE employee.id = staff_attendance.user_id
                AND employee.organization_slug = staff_attendance.organization_slug
                AND employee.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "Admins can insert attendance for any user" ON public.staff_attendance;
CREATE POLICY "Admins can insert attendance for any user" ON public.staff_attendance
FOR INSERT TO authenticated WITH CHECK (
  public.get_user_role(auth.uid())::text IN ('admin','hr','manager','housekeeping_manager')
  AND organization_slug IS NOT NULL
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND EXISTS (SELECT 1 FROM public.profiles employee WHERE employee.id = staff_attendance.user_id
              AND employee.organization_slug = staff_attendance.organization_slug
              AND employee.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "tm_hk_insert_staff_attendance" ON public.staff_attendance;
CREATE POLICY "tm_hk_insert_staff_attendance" ON public.staff_attendance
FOR INSERT TO authenticated WITH CHECK (
  public.is_top_management(auth.uid())
  AND organization_slug IS NOT NULL
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND EXISTS (SELECT 1 FROM public.profiles employee WHERE employee.id = staff_attendance.user_id
              AND employee.organization_slug = staff_attendance.organization_slug
              AND employee.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "Users can update their own attendance" ON public.staff_attendance;
CREATE POLICY "Users can update their own attendance" ON public.staff_attendance
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND organization_slug = public.get_user_organization_slug(auth.uid()))
WITH CHECK (user_id = auth.uid() AND organization_slug = public.get_user_organization_slug(auth.uid()));

DROP POLICY IF EXISTS "tm_hk_update_staff_attendance" ON public.staff_attendance;
CREATE POLICY "tm_hk_update_staff_attendance" ON public.staff_attendance
FOR UPDATE TO authenticated
USING (public.is_top_management(auth.uid()) AND organization_slug = public.get_user_organization_slug(auth.uid())
       AND EXISTS (SELECT 1 FROM public.profiles employee WHERE employee.id = staff_attendance.user_id
                   AND employee.organization_slug = staff_attendance.organization_slug))
WITH CHECK (public.is_top_management(auth.uid()) AND organization_slug = public.get_user_organization_slug(auth.uid())
            AND EXISTS (SELECT 1 FROM public.profiles employee WHERE employee.id = staff_attendance.user_id
                        AND employee.organization_slug = staff_attendance.organization_slug));

DROP POLICY IF EXISTS "tm_hk_delete_staff_attendance" ON public.staff_attendance;
CREATE POLICY "tm_hk_delete_staff_attendance" ON public.staff_attendance
FOR DELETE TO authenticated USING (
  public.is_top_management(auth.uid()) AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND EXISTS (SELECT 1 FROM public.profiles employee WHERE employee.id = staff_attendance.user_id
              AND employee.organization_slug = staff_attendance.organization_slug)
);
