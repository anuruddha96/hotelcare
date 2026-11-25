-- Company work schedule (workforce planning) for RD Hotels.
--
-- Replaces the Excel "WORK_SCHEDULE" workbook: one employee directory that is
-- independent of app logins (kitchen, restaurant and office staff included),
-- departments and job roles HR can maintain, a legend of shift codes, and one
-- entry per employee per day.
--
-- Access is decided here, not in the browser:
--   org      admin, top management, HR (and super admins): every employee
--   property managers: employees based at the hotel they are currently
--            switched to (profiles.assigned_hotel), plus anyone scheduled to
--            work at that hotel
--   self     everyone else: only their own PUBLISHED days, and only when their
--            employee record is linked to their app account
--
-- History is read-only. Days before today cannot be changed, except that
-- admin and HR may still correct the current and previous month (payroll
-- corrections). Employees are never deleted, only made inactive, so history
-- stays complete.
--
-- Separate from staff_schedules on purpose: housekeeping auto-assign keeps
-- reading staff_schedules until the company decides to drive it from this
-- schedule.

-- Helpers ---------------------------------------------------------------------

-- Profiles store either the hotel key or its display name; normalise to the key.
CREATE OR REPLACE FUNCTION public.workforce_hotel_key(_org text, _value text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT h.hotel_id
       FROM public.hotel_configurations h
       JOIN public.organizations o ON o.id = h.organization_id
      WHERE o.slug = _org
        AND (lower(h.hotel_id) = lower(btrim(_value)) OR lower(h.hotel_name) = lower(btrim(_value)))
      LIMIT 1),
    NULLIF(btrim(_value), '')
  );
$$;

CREATE OR REPLACE FUNCTION public.workforce_access()
RETURNS TABLE (organization_slug text, access_level text, hotel_id text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.organization_slug,
         CASE
           WHEN p.is_super_admin IS TRUE
             OR p.role::text IN ('admin', 'top_management', 'top_management_manager', 'hr') THEN 'org'
           WHEN p.role::text IN ('manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager',
                                 'back_office_manager', 'finance_manager', 'control_manager', 'marketing_manager') THEN 'property'
           ELSE 'self'
         END,
         public.workforce_hotel_key(p.organization_slug, p.assigned_hotel),
         CASE WHEN p.is_super_admin IS TRUE THEN 'admin' ELSE p.role::text END
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
$$;

-- Which dates the signed-in person may change.
CREATE OR REPLACE FUNCTION public.workforce_can_edit_date(_date date)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  today date := (timezone('Europe/Budapest', now()))::date;
  actor record;
BEGIN
  SELECT * INTO actor FROM public.workforce_access() LIMIT 1;
  IF actor IS NULL OR actor.access_level = 'self' THEN RETURN false; END IF;
  IF actor.role IN ('admin', 'hr') THEN
    RETURN _date >= (date_trunc('month', today) - interval '1 month')::date;
  END IF;
  RETURN _date >= today;
END;
$$;

REVOKE ALL ON FUNCTION public.workforce_hotel_key(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_can_edit_date(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_hotel_key(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workforce_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.workforce_can_edit_date(date) TO authenticated;

-- Tables ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workforce_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  color text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, name)
);

CREATE TABLE IF NOT EXISTS public.workforce_job_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  department_id uuid NOT NULL REFERENCES public.workforce_departments(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, department_id, name)
);

CREATE TABLE IF NOT EXISTS public.workforce_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
  nickname text,
  department_id uuid REFERENCES public.workforce_departments(id) ON DELETE SET NULL,
  job_role_id uuid REFERENCES public.workforce_job_roles(id) ON DELETE SET NULL,
  -- Base property. NULL = company level (office, central F&B).
  hotel_id text,
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  employment_type text NOT NULL DEFAULT 'full_time'
    CHECK (employment_type IN ('full_time', 'part_time', 'hourly', 'trainee', 'external')),
  daily_hours numeric(4,2) NOT NULL DEFAULT 8 CHECK (daily_hours > 0 AND daily_hours <= 24),
  annual_leave_days numeric(5,1) CHECK (annual_leave_days IS NULL OR annual_leave_days BETWEEN 0 AND 80),
  leave_note text,
  start_date date,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  source_label text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS workforce_staff_org_idx ON public.workforce_staff (organization_slug, hotel_id, is_active);

CREATE TABLE IF NOT EXISTS public.workforce_shift_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 24),
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('work','night','training','home_office','extra_day','leave','half_leave',
                                     'sick','unpaid_leave','absent','day_off','fixed_day_off','other')),
  start_time time,
  end_time time,
  day_fraction numeric(3,2) NOT NULL DEFAULT 1 CHECK (day_fraction > 0 AND day_fraction <= 1),
  hotel_id text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, code)
);

CREATE TABLE IF NOT EXISTS public.workforce_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.workforce_staff(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('work','night','training','home_office','extra_day','leave','half_leave',
                                     'sick','unpaid_leave','absent','day_off','fixed_day_off','other')),
  code text,
  start_time time,
  end_time time,
  day_fraction numeric(3,2) NOT NULL DEFAULT 1 CHECK (day_fraction > 0 AND day_fraction <= 1),
  extra_minutes integer NOT NULL DEFAULT 0 CHECK (extra_minutes BETWEEN -720 AND 720),
  -- Where the person works that day (another hotel when borrowed).
  hotel_id text,
  raw_text text,
  note text,
  worked_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  published_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, work_date),
  CHECK ((start_time IS NULL) = (end_time IS NULL))
);
CREATE INDEX IF NOT EXISTS workforce_entries_org_date_idx ON public.workforce_entries (organization_slug, work_date);
CREATE INDEX IF NOT EXISTS workforce_entries_hotel_date_idx ON public.workforce_entries (hotel_id, work_date);

-- Monthly remarks per employee (the Excel "Megjegyzés" row).
CREATE TABLE IF NOT EXISTS public.workforce_staff_notes (
  staff_id uuid NOT NULL REFERENCES public.workforce_staff(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  organization_slug text NOT NULL,
  note text NOT NULL DEFAULT '',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, month)
);

CREATE TABLE IF NOT EXISTS public.workforce_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_slug text NOT NULL,
  actor_id uuid,
  table_name text NOT NULL,
  action text NOT NULL,
  record_id uuid,
  staff_id uuid,
  work_date date,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_audit_log_idx ON public.workforce_audit_log (organization_slug, created_at DESC);

-- Triggers --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.workforce_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workforce_departments_touch ON public.workforce_departments;
CREATE TRIGGER workforce_departments_touch BEFORE UPDATE ON public.workforce_departments
FOR EACH ROW EXECUTE FUNCTION public.workforce_touch();
DROP TRIGGER IF EXISTS workforce_job_roles_touch ON public.workforce_job_roles;
CREATE TRIGGER workforce_job_roles_touch BEFORE UPDATE ON public.workforce_job_roles
FOR EACH ROW EXECUTE FUNCTION public.workforce_touch();
DROP TRIGGER IF EXISTS workforce_shift_codes_touch ON public.workforce_shift_codes;
CREATE TRIGGER workforce_shift_codes_touch BEFORE UPDATE ON public.workforce_shift_codes
FOR EACH ROW EXECUTE FUNCTION public.workforce_touch();

CREATE OR REPLACE FUNCTION public.workforce_staff_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.hotel_id := public.workforce_hotel_key(NEW.organization_slug, NEW.hotel_id);
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN NEW.created_by := COALESCE(NEW.created_by, auth.uid()); END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  IF NEW.profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = NEW.profile_id AND p.organization_slug = NEW.organization_slug
  ) THEN
    RAISE EXCEPTION 'The linked app account belongs to another organization';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workforce_staff_prepare ON public.workforce_staff;
CREATE TRIGGER workforce_staff_prepare BEFORE INSERT OR UPDATE ON public.workforce_staff
FOR EACH ROW EXECUTE FUNCTION public.workforce_staff_prepare();

-- Hours are calculated here so every screen and report agrees.
-- Clock duration (overnight aware) when a start/end is given, otherwise the
-- employee's daily hours times the day fraction (K/2 = half a day), plus any
-- extra minutes ("+1 óra", "+30p"). Leave, sick and days off count 0 hours.
CREATE OR REPLACE FUNCTION public.workforce_entry_prepare()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  person record;
  minutes integer;
BEGIN
  SELECT s.organization_slug, s.hotel_id, s.daily_hours INTO person
    FROM public.workforce_staff s WHERE s.id = NEW.staff_id;
  IF person IS NULL THEN RAISE EXCEPTION 'Unknown employee'; END IF;
  NEW.organization_slug := person.organization_slug;
  NEW.hotel_id := COALESCE(public.workforce_hotel_key(person.organization_slug, NEW.hotel_id), person.hotel_id);

  IF NEW.kind IN ('work', 'night', 'training', 'home_office', 'extra_day') THEN
    IF NEW.start_time IS NOT NULL AND NEW.end_time IS NOT NULL AND NEW.start_time <> NEW.end_time THEN
      minutes := (extract(epoch FROM (NEW.end_time - NEW.start_time)) / 60)::integer;
      IF minutes <= 0 THEN minutes := minutes + 1440; END IF;
    ELSE
      minutes := round(COALESCE(person.daily_hours, 8) * 60 * NEW.day_fraction);
    END IF;
    NEW.worked_minutes := greatest(0, minutes + NEW.extra_minutes);
  ELSIF NEW.kind = 'half_leave' THEN
    NEW.worked_minutes := greatest(0, round(COALESCE(person.daily_hours, 8) * 30)::integer + NEW.extra_minutes);
  ELSE
    NEW.worked_minutes := 0;
  END IF;

  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
    NEW.published_by := COALESCE(NEW.published_by, auth.uid());
  END IF;
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN NEW.created_by := COALESCE(NEW.created_by, auth.uid()); END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS workforce_entry_prepare ON public.workforce_entries;
CREATE TRIGGER workforce_entry_prepare BEFORE INSERT OR UPDATE ON public.workforce_entries
FOR EACH ROW EXECUTE FUNCTION public.workforce_entry_prepare();

CREATE OR REPLACE FUNCTION public.workforce_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_row jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  source jsonb := COALESCE(new_row, old_row);
BEGIN
  -- Bulk imports (service role, or the workforce_import function which writes
  -- one summary row) are not audited row by row.
  IF auth.uid() IS NULL OR current_setting('workforce.importing', true) = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (old_row - 'updated_at' - 'updated_by') = (new_row - 'updated_at' - 'updated_by') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.workforce_audit_log (organization_slug, actor_id, table_name, action, record_id, staff_id, work_date, before, after)
  VALUES (
    source->>'organization_slug', auth.uid(), TG_TABLE_NAME, TG_OP,
    (source->>'id')::uuid,
    CASE WHEN TG_TABLE_NAME = 'workforce_entries' THEN (source->>'staff_id')::uuid ELSE (source->>'id')::uuid END,
    (source->>'work_date')::date,
    old_row, new_row
  );
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS workforce_entries_audit ON public.workforce_entries;
CREATE TRIGGER workforce_entries_audit AFTER INSERT OR UPDATE OR DELETE ON public.workforce_entries
FOR EACH ROW EXECUTE FUNCTION public.workforce_audit();
DROP TRIGGER IF EXISTS workforce_staff_audit ON public.workforce_staff;
CREATE TRIGGER workforce_staff_audit AFTER INSERT OR UPDATE OR DELETE ON public.workforce_staff
FOR EACH ROW EXECUTE FUNCTION public.workforce_audit();

REVOKE ALL ON FUNCTION public.workforce_touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workforce_staff_prepare() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workforce_entry_prepare() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workforce_audit() FROM PUBLIC, anon, authenticated;

-- Row-level security ------------------------------------------------------------
-- Uncorrelated (SELECT ... FROM workforce_access()) sub-queries run once per
-- statement, not once per row.

ALTER TABLE public.workforce_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_job_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_shift_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_staff_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workforce_departments, public.workforce_job_roles, public.workforce_staff,
  public.workforce_shift_codes, public.workforce_entries, public.workforce_staff_notes,
  public.workforce_audit_log FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.workforce_departments, public.workforce_job_roles,
  public.workforce_staff, public.workforce_shift_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workforce_entries, public.workforce_staff_notes TO authenticated;
GRANT SELECT ON public.workforce_audit_log TO authenticated;
GRANT ALL ON public.workforce_departments, public.workforce_job_roles, public.workforce_staff,
  public.workforce_shift_codes, public.workforce_entries, public.workforce_staff_notes,
  public.workforce_audit_log TO service_role;

-- Reference lists: readable by everyone in the organization, maintained by org level.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workforce_departments', 'workforce_job_roles', 'workforce_shift_codes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "workforce read reference" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "workforce read reference" ON public.%I FOR SELECT TO authenticated
      USING (organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a))$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS "workforce maintain reference" ON public.%I', t);
    EXECUTE format($p$CREATE POLICY "workforce maintain reference" ON public.%I FOR ALL TO authenticated
      USING (organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
             AND (SELECT a.access_level FROM public.workforce_access() a) = 'org')
      WITH CHECK (organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
             AND (SELECT a.access_level FROM public.workforce_access() a) = 'org')$p$, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "workforce read staff" ON public.workforce_staff;
CREATE POLICY "workforce read staff" ON public.workforce_staff FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR (
      (SELECT a.access_level FROM public.workforce_access() a) = 'property'
      AND (
        hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a)
        OR EXISTS (SELECT 1 FROM public.workforce_entries e
                    WHERE e.staff_id = workforce_staff.id
                      AND e.hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a))
      )
    )
    OR profile_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "workforce add staff" ON public.workforce_staff;
CREATE POLICY "workforce add staff" ON public.workforce_staff FOR INSERT TO authenticated
WITH CHECK (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_hotel_key(organization_slug, hotel_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
);

DROP POLICY IF EXISTS "workforce edit staff" ON public.workforce_staff;
CREATE POLICY "workforce edit staff" ON public.workforce_staff FOR UPDATE TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
)
WITH CHECK (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_hotel_key(organization_slug, hotel_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
);

DROP POLICY IF EXISTS "workforce read entries" ON public.workforce_entries;
CREATE POLICY "workforce read entries" ON public.workforce_entries FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR (
      (SELECT a.access_level FROM public.workforce_access() a) = 'property'
      AND (
        hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a)
        OR EXISTS (SELECT 1 FROM public.workforce_staff s
                    WHERE s.id = workforce_entries.staff_id
                      AND s.hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a))
      )
    )
    OR (status = 'published' AND EXISTS (
          SELECT 1 FROM public.workforce_staff s
           WHERE s.id = workforce_entries.staff_id AND s.profile_id = (SELECT auth.uid())))
  )
);

DROP POLICY IF EXISTS "workforce write entries" ON public.workforce_entries;
CREATE POLICY "workforce write entries" ON public.workforce_entries FOR ALL TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND public.workforce_can_edit_date(work_date)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND EXISTS (SELECT 1 FROM public.workforce_staff s
                     WHERE s.id = workforce_entries.staff_id
                       AND s.hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a)))
  )
)
WITH CHECK (
  public.workforce_can_edit_date(work_date)
  AND EXISTS (SELECT 1 FROM public.workforce_staff s
               WHERE s.id = workforce_entries.staff_id
                 AND s.organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
                 AND ((SELECT a.access_level FROM public.workforce_access() a) = 'org'
                      OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
                          AND s.hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a))))
);

DROP POLICY IF EXISTS "workforce notes" ON public.workforce_staff_notes;
CREATE POLICY "workforce notes" ON public.workforce_staff_notes FOR ALL TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND EXISTS (SELECT 1 FROM public.workforce_staff s
                     WHERE s.id = workforce_staff_notes.staff_id
                       AND s.hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a)))
  )
)
WITH CHECK (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND EXISTS (SELECT 1 FROM public.workforce_staff s
                     WHERE s.id = workforce_staff_notes.staff_id
                       AND s.hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a)))
  )
);

DROP POLICY IF EXISTS "workforce read audit" ON public.workforce_audit_log;
CREATE POLICY "workforce read audit" ON public.workforce_audit_log FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (SELECT a.access_level FROM public.workforce_access() a) = 'org'
);

-- Publishing a month: drafts become visible to the employees concerned.
-- Only rows the caller may edit are touched (RLS still applies inside).
CREATE OR REPLACE FUNCTION public.workforce_publish(_from date, _to date, _staff_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE changed integer;
BEGIN
  IF _to < _from OR _to - _from > 62 THEN RAISE EXCEPTION 'Publish at most two months at a time'; END IF;
  UPDATE public.workforce_entries
     SET status = 'published', published_at = now(), published_by = auth.uid()
   WHERE status = 'draft' AND work_date BETWEEN _from AND _to
     AND (_staff_ids IS NULL OR staff_id = ANY(_staff_ids));
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_publish(date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_publish(date, date, uuid[]) TO authenticated;

-- Excel import (admin and HR only) -------------------------------------------
-- The browser reads the workbook (colours included) and sends batches. This is
-- the only way to write history in bulk; it fills empty days unless
-- _overwrite is true. Every batch is recorded in the audit log.
CREATE OR REPLACE FUNCTION public.workforce_import(_payload jsonb, _overwrite boolean DEFAULT false, _source text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor record;
  org text;
  n_dept integer := 0; n_role integer := 0; n_staff integer := 0; n_entries integer := 0; n_notes integer := 0;
BEGIN
  SELECT * INTO actor FROM public.workforce_access() LIMIT 1;
  IF actor IS NULL OR actor.access_level <> 'org' OR actor.role NOT IN ('admin', 'hr') THEN
    RAISE EXCEPTION 'Only administrators and HR can import a schedule workbook';
  END IF;
  org := actor.organization_slug;
  IF jsonb_typeof(_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid import payload'; END IF;
  PERFORM set_config('workforce.importing', 'on', true);
  IF jsonb_array_length(COALESCE(_payload->'entries', '[]')) > 5000
     OR jsonb_array_length(COALESCE(_payload->'staff', '[]')) > 600 THEN
    RAISE EXCEPTION 'Import batch too large';
  END IF;

  INSERT INTO public.workforce_departments (id, organization_slug, name, color, sort_order)
  SELECT x.id, org, x.name, x.color, COALESCE(x.sort_order, 0)
    FROM jsonb_to_recordset(COALESCE(_payload->'departments', '[]')) AS x(id uuid, name text, color text, sort_order int)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_dept = ROW_COUNT;

  INSERT INTO public.workforce_job_roles (id, organization_slug, department_id, name, sort_order)
  SELECT x.id, org, x.department_id, x.name, COALESCE(x.sort_order, 0)
    FROM jsonb_to_recordset(COALESCE(_payload->'job_roles', '[]')) AS x(id uuid, department_id uuid, name text, sort_order int)
   WHERE EXISTS (SELECT 1 FROM public.workforce_departments d WHERE d.id = x.department_id AND d.organization_slug = org)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n_role = ROW_COUNT;

  INSERT INTO public.workforce_shift_codes (organization_slug, code, label, kind, start_time, end_time, day_fraction, sort_order)
  SELECT org, x.code, x.label, x.kind, x.start_time, x.end_time, COALESCE(x.day_fraction, 1), COALESCE(x.sort_order, 0)
    FROM jsonb_to_recordset(COALESCE(_payload->'shift_codes', '[]'))
      AS x(code text, label text, kind text, start_time time, end_time time, day_fraction numeric, sort_order int)
  ON CONFLICT (organization_slug, code) DO NOTHING;

  INSERT INTO public.workforce_staff (id, organization_slug, full_name, nickname, department_id, job_role_id, hotel_id,
    profile_id, employment_type, daily_hours, annual_leave_days, leave_note, end_date, is_active, sort_order, notes, source_label)
  SELECT x.id, org, x.full_name, x.nickname, x.department_id, x.job_role_id, x.hotel_id,
         CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.profile_id AND p.organization_slug = org)
                   AND NOT EXISTS (SELECT 1 FROM public.workforce_staff w WHERE w.profile_id = x.profile_id)
              THEN x.profile_id END,
         COALESCE(x.employment_type, 'full_time'), COALESCE(x.daily_hours, 8), x.annual_leave_days, x.leave_note,
         x.end_date, COALESCE(x.is_active, true), COALESCE(x.sort_order, 0), x.notes, x.source_label
    FROM jsonb_to_recordset(COALESCE(_payload->'staff', '[]')) AS x(
      id uuid, full_name text, nickname text, department_id uuid, job_role_id uuid, hotel_id text, profile_id uuid,
      employment_type text, daily_hours numeric, annual_leave_days numeric, leave_note text, end_date date,
      is_active boolean, sort_order int, notes text, source_label text)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS n_staff = ROW_COUNT;

  IF _overwrite THEN
    INSERT INTO public.workforce_entries AS e (staff_id, work_date, kind, code, start_time, end_time, day_fraction,
      extra_minutes, hotel_id, raw_text, note, status)
    SELECT x.staff_id, x.work_date, x.kind, x.code, x.start_time, x.end_time, COALESCE(x.day_fraction, 1),
           COALESCE(x.extra_minutes, 0), x.hotel_id, left(x.raw_text, 500), left(x.note, 500), COALESCE(x.status, 'draft')
      FROM jsonb_to_recordset(COALESCE(_payload->'entries', '[]')) AS x(
        staff_id uuid, work_date date, kind text, code text, start_time time, end_time time, day_fraction numeric,
        extra_minutes int, hotel_id text, raw_text text, note text, status text)
     WHERE EXISTS (SELECT 1 FROM public.workforce_staff s WHERE s.id = x.staff_id AND s.organization_slug = org)
    ON CONFLICT (staff_id, work_date) DO UPDATE SET
      kind = excluded.kind, code = excluded.code, start_time = excluded.start_time, end_time = excluded.end_time,
      day_fraction = excluded.day_fraction, extra_minutes = excluded.extra_minutes, hotel_id = excluded.hotel_id,
      raw_text = excluded.raw_text, note = excluded.note;
  ELSE
    INSERT INTO public.workforce_entries (staff_id, work_date, kind, code, start_time, end_time, day_fraction,
      extra_minutes, hotel_id, raw_text, note, status)
    SELECT x.staff_id, x.work_date, x.kind, x.code, x.start_time, x.end_time, COALESCE(x.day_fraction, 1),
           COALESCE(x.extra_minutes, 0), x.hotel_id, left(x.raw_text, 500), left(x.note, 500), COALESCE(x.status, 'draft')
      FROM jsonb_to_recordset(COALESCE(_payload->'entries', '[]')) AS x(
        staff_id uuid, work_date date, kind text, code text, start_time time, end_time time, day_fraction numeric,
        extra_minutes int, hotel_id text, raw_text text, note text, status text)
     WHERE EXISTS (SELECT 1 FROM public.workforce_staff s WHERE s.id = x.staff_id AND s.organization_slug = org)
    ON CONFLICT (staff_id, work_date) DO NOTHING;
  END IF;
  GET DIAGNOSTICS n_entries = ROW_COUNT;

  INSERT INTO public.workforce_staff_notes (staff_id, month, organization_slug, note, updated_by)
  SELECT x.staff_id, x.month, org, left(x.note, 2000), auth.uid()
    FROM jsonb_to_recordset(COALESCE(_payload->'notes', '[]')) AS x(staff_id uuid, month date, note text)
   WHERE EXISTS (SELECT 1 FROM public.workforce_staff s WHERE s.id = x.staff_id AND s.organization_slug = org)
  ON CONFLICT (staff_id, month) DO NOTHING;
  GET DIAGNOSTICS n_notes = ROW_COUNT;

  INSERT INTO public.workforce_audit_log (organization_slug, actor_id, table_name, action, after)
  VALUES (org, auth.uid(), 'workforce_import', 'IMPORT', jsonb_build_object(
    'source', left(_source, 200), 'overwrite', _overwrite, 'departments', n_dept, 'job_roles', n_role,
    'staff', n_staff, 'entries', n_entries, 'notes', n_notes));

  PERFORM set_config('workforce.importing', 'off', true);
  RETURN jsonb_build_object('departments', n_dept, 'job_roles', n_role, 'staff', n_staff, 'entries', n_entries, 'notes', n_notes);
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_import(jsonb, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_import(jsonb, boolean, text) TO authenticated;
