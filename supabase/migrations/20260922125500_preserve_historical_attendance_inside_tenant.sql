-- Preserve former employees' timesheets for their own HR; deletion is not a tenant boundary.
CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(
  target_user_id uuid DEFAULT NULL::uuid,
  start_date date DEFAULT (CURRENT_DATE - '30 days'::interval),
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(id uuid, user_id uuid, check_in_time timestamptz, check_out_time timestamptz,
  check_in_location jsonb, check_out_location jsonb, work_date date, total_hours numeric,
  break_duration integer, status text, notes text, full_name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
         sa.check_in_location, sa.check_out_location, sa.work_date,
         sa.total_hours, sa.break_duration, sa.status, sa.notes,
         employee.full_name, employee.role::text
  FROM public.staff_attendance sa
  JOIN public.profiles employee ON employee.id = sa.user_id
  JOIN public.profiles caller ON caller.id = auth.uid()
  WHERE caller.deleted_at IS NULL
    AND caller.organization_slug IS NOT NULL
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

DROP POLICY IF EXISTS "Users can view all their own attendance records" ON public.staff_attendance;
CREATE POLICY "Users can view all their own attendance records" ON public.staff_attendance
FOR SELECT TO authenticated USING (
  organization_slug IS NOT NULL
  AND organization_slug = public.get_user_organization_slug(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.profiles employee
    WHERE employee.id = staff_attendance.user_id
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
                AND employee.organization_slug = staff_attendance.organization_slug)
);
