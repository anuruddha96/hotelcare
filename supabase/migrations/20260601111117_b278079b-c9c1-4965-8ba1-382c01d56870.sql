
-- 1) profiles SELECT policies include top_management_manager
DROP POLICY IF EXISTS "Housekeepers can view other housekeepers in same hotel" ON public.profiles;
CREATE POLICY "Housekeepers can view other housekeepers in same hotel"
ON public.profiles FOR SELECT
USING (
  (auth.uid() = id)
  OR (public.get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role, 'top_management_manager'::user_role]))
  OR (
    (role = 'housekeeping'::user_role)
    AND (assigned_hotel IS NOT NULL)
    AND (assigned_hotel = public.get_user_assigned_hotel(auth.uid()))
    AND (public.get_user_role(auth.uid()) = 'housekeeping'::user_role)
  )
);

DROP POLICY IF EXISTS profiles_select_admin_hr_hm_manager ON public.profiles;
CREATE POLICY profiles_select_admin_hr_hm_manager
ON public.profiles FOR SELECT
USING (
  public.get_current_user_role() = ANY (ARRAY['admin'::user_role, 'hr'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'top_management'::user_role, 'top_management_manager'::user_role])
);

-- 2) purchase_invoices policies include top_management_manager
DROP POLICY IF EXISTS pi_full_admin_top_ctrl_select ON public.purchase_invoices;
CREATE POLICY pi_full_admin_top_ctrl_select
ON public.purchase_invoices FOR SELECT
USING (
  (public.pi_user_role() = ANY (ARRAY['admin'::text, 'top_management'::text, 'top_management_manager'::text, 'control_finance'::text]))
  AND (organization_slug = public.pi_user_org())
);

DROP POLICY IF EXISTS pi_full_admin_top_ctrl_update ON public.purchase_invoices;
CREATE POLICY pi_full_admin_top_ctrl_update
ON public.purchase_invoices FOR UPDATE
USING (
  (public.pi_user_role() = ANY (ARRAY['admin'::text, 'top_management'::text, 'top_management_manager'::text, 'control_finance'::text]))
  AND (organization_slug = public.pi_user_org())
);

DROP POLICY IF EXISTS pi_full_admin_delete ON public.purchase_invoices;
CREATE POLICY pi_full_admin_delete
ON public.purchase_invoices FOR DELETE
USING (
  (public.pi_user_role() = ANY (ARRAY['admin'::text, 'top_management'::text, 'top_management_manager'::text]))
  AND (organization_slug = public.pi_user_org())
);

-- 3) Attendance RPCs include top_management_manager in the unrestricted branch
CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(target_user_id uuid DEFAULT NULL::uuid, start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), end_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(id uuid, user_id uuid, check_in_time timestamp with time zone, check_out_time timestamp with time zone, check_in_location jsonb, check_out_location jsonb, work_date date, total_hours numeric, break_duration integer, status text, notes text, full_name text, role text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
  resolved_hotel_id text;
  resolved_hotel_name text;
BEGIN
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT p.assigned_hotel INTO current_user_hotel FROM public.profiles p WHERE p.id = auth.uid();

  IF current_user_role IN ('admin', 'hr', 'top_management', 'top_management_manager') THEN
    RETURN QUERY
    SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
      sa.check_in_location, sa.check_out_location, sa.work_date,
      sa.total_hours, sa.break_duration, sa.status, sa.notes,
      p.full_name, p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;

  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
    SELECT hc.hotel_id, hc.hotel_name INTO resolved_hotel_id, resolved_hotel_name
    FROM public.hotel_configurations hc
    WHERE hc.hotel_id = current_user_hotel OR hc.hotel_name = current_user_hotel
    LIMIT 1;

    RETURN QUERY
    SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
      sa.check_in_location, sa.check_out_location, sa.work_date,
      sa.total_hours, sa.break_duration, sa.status, sa.notes,
      p.full_name, p.role::text
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
      AND (
        p.assigned_hotel = current_user_hotel
        OR p.assigned_hotel = resolved_hotel_id
        OR p.assigned_hotel = resolved_hotel_name
      )
    ORDER BY sa.work_date DESC, sa.check_in_time DESC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT sa.id, sa.user_id, sa.check_in_time, sa.check_out_time,
    sa.check_in_location, sa.check_out_location, sa.work_date,
    sa.total_hours, sa.break_duration, sa.status, sa.notes,
    p.full_name, p.role::text
  FROM public.staff_attendance sa
  JOIN public.profiles p ON sa.user_id = p.id
  WHERE sa.user_id = auth.uid()
    AND sa.work_date BETWEEN start_date AND end_date
  ORDER BY sa.work_date DESC, sa.check_in_time DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_attendance_summary_secure(target_user_id uuid DEFAULT NULL::uuid, start_date date DEFAULT (CURRENT_DATE - '30 days'::interval), end_date date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
  summary_data json;
BEGIN
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT assigned_hotel INTO current_user_hotel FROM public.profiles WHERE id = auth.uid();

  IF current_user_role IN ('admin', 'hr', 'top_management', 'top_management_manager') THEN
    SELECT json_build_object(
      'total_days', COALESCE(COUNT(DISTINCT sa.work_date), 0),
      'total_hours', COALESCE(SUM(sa.total_hours), 0),
      'avg_hours_per_day', COALESCE(CASE WHEN COUNT(DISTINCT sa.work_date) > 0 THEN SUM(sa.total_hours) / COUNT(DISTINCT sa.work_date) ELSE 0 END, 0),
      'punctual_days', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time <= '09:00:00'), 0),
      'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time > '09:00:00'), 0),
      'early_departures', COALESCE(COUNT(*) FILTER (WHERE sa.check_out_time::time < '17:00:00' AND sa.check_out_time IS NOT NULL), 0)
    ) INTO summary_data
    FROM public.staff_attendance sa
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date;
    RETURN summary_data;
  END IF;

  IF current_user_role IN ('manager', 'housekeeping_manager') AND current_user_hotel IS NOT NULL THEN
    SELECT json_build_object(
      'total_days', COALESCE(COUNT(DISTINCT sa.work_date), 0),
      'total_hours', COALESCE(SUM(sa.total_hours), 0),
      'avg_hours_per_day', COALESCE(CASE WHEN COUNT(DISTINCT sa.work_date) > 0 THEN SUM(sa.total_hours) / COUNT(DISTINCT sa.work_date) ELSE 0 END, 0),
      'punctual_days', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time <= '09:00:00'), 0),
      'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time > '09:00:00'), 0),
      'early_departures', COALESCE(COUNT(*) FILTER (WHERE sa.check_out_time::time < '17:00:00' AND sa.check_out_time IS NOT NULL), 0)
    ) INTO summary_data
    FROM public.staff_attendance sa
    JOIN public.profiles p ON sa.user_id = p.id
    WHERE (target_user_id IS NULL OR sa.user_id = target_user_id)
      AND sa.work_date BETWEEN start_date AND end_date
      AND (p.assigned_hotel = current_user_hotel OR sa.user_id = auth.uid());
    RETURN summary_data;
  END IF;

  SELECT json_build_object(
    'total_days', COALESCE(COUNT(DISTINCT sa.work_date), 0),
    'total_hours', COALESCE(SUM(sa.total_hours), 0),
    'avg_hours_per_day', COALESCE(CASE WHEN COUNT(DISTINCT sa.work_date) > 0 THEN SUM(sa.total_hours) / COUNT(DISTINCT sa.work_date) ELSE 0 END, 0),
    'punctual_days', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time <= '09:00:00'), 0),
    'late_arrivals', COALESCE(COUNT(*) FILTER (WHERE sa.check_in_time::time > '09:00:00'), 0),
    'early_departures', COALESCE(COUNT(*) FILTER (WHERE sa.check_out_time::time < '17:00:00' AND sa.check_out_time IS NOT NULL), 0)
  ) INTO summary_data
  FROM public.staff_attendance sa
  WHERE sa.user_id = auth.uid()
    AND sa.work_date BETWEEN start_date AND end_date;

  RETURN summary_data;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_employees_by_hotel()
 RETURNS TABLE(id uuid, full_name text, role user_role, assigned_hotel text, email text, created_at timestamp with time zone)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  current_user_role text;
  current_user_hotel text;
  current_user_hotel_name text;
BEGIN
  SELECT public.get_user_role(auth.uid())::text INTO current_user_role;
  SELECT p.assigned_hotel INTO current_user_hotel FROM public.profiles p WHERE p.id = auth.uid();

  IF current_user_hotel IS NOT NULL THEN
    SELECT public.get_hotel_name_from_id(current_user_hotel) INTO current_user_hotel_name;
  END IF;

  -- Org-wide roles see everything (checked first so their assigned hotel doesn't narrow results)
  IF current_user_role IN ('admin', 'hr', 'top_management', 'top_management_manager') THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE p.role != 'admin'
    ORDER BY p.full_name;
    RETURN;
  END IF;

  IF current_user_hotel IS NOT NULL THEN
    RETURN QUERY
    SELECT p.id, p.full_name, p.role, p.assigned_hotel, p.email, p.created_at
    FROM public.profiles p
    WHERE (
      p.assigned_hotel = current_user_hotel
      OR p.assigned_hotel = current_user_hotel_name
    )
    AND p.role IN ('housekeeping', 'reception', 'maintenance', 'marketing', 'control_finance', 'front_office', 'manager', 'housekeeping_manager')
    ORDER BY p.full_name;
    RETURN;
  END IF;

  RETURN;
END;
$function$;
