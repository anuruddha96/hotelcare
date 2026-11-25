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
-- Department-specific manager security roles do not have the existing
-- general org-wide profiles SELECT policy. Permit only their own property's
-- directory, translating display names/IDs without exposing other properties.
CREATE POLICY "RD department managers view property staff"
ON public.profiles FOR SELECT TO authenticated
USING (
  organization_slug = 'rdhotels' AND deleted_at IS NULL
  AND public.get_user_organization_slug((select auth.uid())) = 'rdhotels'
  AND public.get_user_role((select auth.uid()))::text IN
    ('maintenance_manager','reception_manager','finance_manager',
     'control_manager','marketing_manager','back_office_manager')
  AND EXISTS (
    SELECT 1 FROM public.hotel_configurations h
    JOIN public.organizations o ON o.id = h.organization_id
    WHERE o.slug = 'rdhotels'
      AND public.get_user_assigned_hotel((select auth.uid())) IN (h.hotel_id,h.hotel_name)
      AND profiles.assigned_hotel IN (h.hotel_id,h.hotel_name)
  )
);

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
      public.get_user_role((select auth.uid()))::text IN ('manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager', 'finance_manager', 'control_manager', 'marketing_manager', 'back_office_manager')
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
      public.get_user_role((select auth.uid()))::text IN ('manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager', 'finance_manager', 'control_manager', 'marketing_manager', 'back_office_manager')
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
      public.get_user_role((select auth.uid()))::text IN ('manager','housekeeping_manager','maintenance_manager','reception_manager','finance_manager','control_manager','marketing_manager','back_office_manager')
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
      public.get_user_role((select auth.uid()))::text IN ('manager','housekeeping_manager','maintenance_manager','reception_manager','finance_manager','control_manager','marketing_manager','back_office_manager')
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
            ('manager','housekeeping_manager','maintenance_manager','reception_manager','finance_manager','control_manager','marketing_manager','back_office_manager')
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
            ('manager','housekeeping_manager','maintenance_manager','reception_manager','finance_manager','control_manager','marketing_manager','back_office_manager')
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
     OR actor.role::text NOT IN ('admin','top_management','top_management_manager','hr','manager','housekeeping_manager','maintenance_manager','reception_manager','finance_manager','control_manager','marketing_manager','back_office_manager') THEN
    RAISE EXCEPTION 'Not authorized to update staff position';
  END IF;
  IF actor.role::text IN ('manager','housekeeping_manager','maintenance_manager','reception_manager','finance_manager','control_manager','marketing_manager','back_office_manager') AND NOT EXISTS (
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


-- Historical Excel entries are inserted through a narrow, audited HR/executive
-- import function. Normal Data API INSERT/UPDATE remains blocked for past dates.
-- Past entries are marked published solely for read-only roster visibility:
-- room assignment algorithms always operate on future/current dates and should
-- continue ignoring past dates.
CREATE TABLE IF NOT EXISTS public.rd_historical_roster_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  source_file text,
  imported_count integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rd_historical_roster_import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "RD HR and executives read archival import audits"
ON public.rd_historical_roster_import_batches FOR SELECT TO authenticated
USING (
  public.get_user_organization_slug((select auth.uid())) = 'rdhotels'
  AND public.get_user_role((select auth.uid()))::text IN
    ('admin','top_management','top_management_manager','hr')
);

CREATE FUNCTION public.rd_import_historical_staff_schedules(
  _rows jsonb, _source_file text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE
  actor public.profiles%ROWTYPE;
  employee public.profiles%ROWTYPE;
  entry jsonb;
  employee_id uuid;
  hotel text;
  work_day date;
  work_state text;
  start_time time without time zone;
  end_time time without time zone;
  new_id uuid;
  count_imported integer := 0;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.deleted_at IS NOT NULL
     OR actor.organization_slug IS DISTINCT FROM 'rdhotels'
     OR actor.role::text NOT IN ('admin','top_management','top_management_manager','hr') THEN
    RAISE EXCEPTION 'Only RD Hotels HR and executives may import historical schedules';
  END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array'
     OR jsonb_array_length(_rows) < 1 OR jsonb_array_length(_rows) > 100 THEN
    RAISE EXCEPTION 'One to 100 historical schedule entries are required per batch';
  END IF;
  IF length(coalesce(_source_file,'')) > 200 THEN
    RAISE EXCEPTION 'Source filename is too long';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    IF jsonb_typeof(entry) <> 'object' THEN
      RAISE EXCEPTION 'Invalid schedule entry';
    END IF;
    employee_id := (entry->>'user_id')::uuid;
    work_day := (entry->>'work_date')::date;
    hotel := nullif(btrim(entry->>'hotel_id'), '');
    work_state := entry->>'work_status';
    IF employee_id IS NULL OR work_day IS NULL OR hotel IS NULL
       OR work_day >= (timezone('Europe/Budapest',now()))::date
       OR work_day < ((timezone('Europe/Budapest',now()))::date - INTERVAL '3 years')::date
       OR work_state IS NULL OR work_state NOT IN ('working','training','off','leave','sick') THEN
      RAISE EXCEPTION 'Historical schedule date, employee, property or status is invalid';
    END IF;

    SELECT * INTO employee FROM public.profiles WHERE id = employee_id;
    IF employee.id IS NULL OR employee.organization_slug IS DISTINCT FROM 'rdhotels'
       OR NOT EXISTS (
         SELECT 1 FROM public.hotel_configurations h
         JOIN public.organizations o ON o.id = h.organization_id
         WHERE o.slug='rdhotels' AND h.hotel_id=hotel
           AND employee.assigned_hotel IN (h.hotel_id,h.hotel_name)
       ) THEN
      RAISE EXCEPTION 'Historical staff member is not assigned to the specified RD hotel';
    END IF;

    start_time := NULL;
    end_time := NULL;
    IF work_state IN ('working','training') THEN
      start_time := (entry->>'shift_start')::time;
      end_time := (entry->>'shift_end')::time;
      IF start_time IS NULL OR end_time IS NULL OR start_time = end_time THEN
        RAISE EXCEPTION 'Active historical shift requires valid, distinct start/end times';
      END IF;
    END IF;

    -- Do not overwrite an already-entered schedule (even across base hotels).
    IF EXISTS (
      SELECT 1 FROM public.staff_schedules s
      WHERE s.organization_slug = 'rdhotels'
        AND s.user_id = employee_id AND s.work_date = work_day
    ) THEN
      CONTINUE;
    END IF;

    new_id := NULL;
    INSERT INTO public.staff_schedules (
      organization_slug,hotel_id,user_id,work_date,
      shift_start,shift_end,work_status,status,
      notes,created_by,published_by,published_at
    ) VALUES (
      'rdhotels',hotel,employee_id,work_day,
      start_time,end_time,work_state,'published',
      'Imported historical Excel archive: ' || coalesce(left(_source_file,120),'approved workbook'),
      auth.uid(),auth.uid(),now()
    )
    ON CONFLICT (organization_slug,hotel_id,user_id,work_date) DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NOT NULL THEN count_imported := count_imported + 1; END IF;
  END LOOP;

  INSERT INTO public.rd_historical_roster_import_batches
    (actor_id,source_file,imported_count)
  VALUES (auth.uid(),_source_file,count_imported);
  RETURN count_imported;
END;
$body$;
REVOKE ALL ON FUNCTION public.rd_import_historical_staff_schedules(jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rd_import_historical_staff_schedules(jsonb,text) TO authenticated;


-- Protect RD staffing authorization claims against self-service profile UPDATE.
-- An existing permissive own-profile policy otherwise lets a user change
-- assigned_hotel, role, or acts_as_housekeeper and gain access indirectly.
-- Only changes to non-sensitive profile fields are self-service.
CREATE FUNCTION public.rd_protect_profile_authorization_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
DECLARE
  actor public.profiles%ROWTYPE;
BEGIN
  IF OLD.organization_slug IS DISTINCT FROM 'rdhotels'
     AND NEW.organization_slug IS DISTINCT FROM 'rdhotels' THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  IF actor.id IS NULL OR actor.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Profile change not authorized';
  END IF;

  IF actor.id = OLD.id AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
    OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
    OR NEW.assigned_hotel IS DISTINCT FROM OLD.assigned_hotel
    OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
    OR NEW.acts_as_housekeeper IS DISTINCT FROM OLD.acts_as_housekeeper
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
    OR NEW.deleted_by IS DISTINCT FROM OLD.deleted_by
  ) THEN
    RAISE EXCEPTION 'Users cannot change their own access, role, organization or hotel';
  END IF;

  IF (NEW.role IS DISTINCT FROM OLD.role
      OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
      OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin)
     AND (
       actor.organization_slug IS DISTINCT FROM 'rdhotels'
       OR actor.role::text <> 'admin'
     ) THEN
    RAISE EXCEPTION 'Role and organization changes require an RD Hotels administrator';
  END IF;
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
     AND actor.is_super_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Super-administrator privileges cannot be delegated';
  END IF;
  RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION public.rd_protect_profile_authorization_fields() FROM PUBLIC;

CREATE TRIGGER rd_prevent_profile_access_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.rd_protect_profile_authorization_fields();
