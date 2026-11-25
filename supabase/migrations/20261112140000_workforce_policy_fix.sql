-- Work schedule fixes:
-- 1. The staff and entries policies looked each other up, which Postgres
--    reports as "infinite recursion detected in policy". Cross-table checks now
--    go through small SECURITY DEFINER helpers that read without RLS.
-- 2. Top management can import the Excel workbook and correct last month,
--    like admin and HR (every company-level role).

CREATE OR REPLACE FUNCTION public.workforce_staff_hotel(_staff uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT s.hotel_id FROM public.workforce_staff s WHERE s.id = _staff $$;

CREATE OR REPLACE FUNCTION public.workforce_staff_org(_staff uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT s.organization_slug FROM public.workforce_staff s WHERE s.id = _staff $$;

CREATE OR REPLACE FUNCTION public.workforce_staff_is_mine(_staff uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT EXISTS (SELECT 1 FROM public.workforce_staff s WHERE s.id = _staff AND s.profile_id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.workforce_staff_works_at(_staff uuid, _hotel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT _hotel IS NOT NULL AND EXISTS (SELECT 1 FROM public.workforce_entries e WHERE e.staff_id = _staff AND e.hotel_id = _hotel) $$;

REVOKE ALL ON FUNCTION public.workforce_staff_hotel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_staff_org(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_staff_is_mine(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_staff_works_at(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_staff_hotel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workforce_staff_org(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workforce_staff_is_mine(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workforce_staff_works_at(uuid, text) TO authenticated;

-- Company-level roles (admin, top management, HR) may correct last month.
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
  IF actor.access_level = 'org' THEN
    RETURN _date >= (date_trunc('month', today) - interval '1 month')::date;
  END IF;
  RETURN _date >= today;
END;
$$;

DROP POLICY IF EXISTS "workforce read staff" ON public.workforce_staff;
CREATE POLICY "workforce read staff" ON public.workforce_staff FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR profile_id = (SELECT auth.uid())
    OR (
      (SELECT a.access_level FROM public.workforce_access() a) = 'property'
      AND (
        hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a)
        OR public.workforce_staff_works_at(id, (SELECT a.hotel_id FROM public.workforce_access() a))
      )
    )
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
        OR public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a)
      )
    )
    OR (status = 'published' AND public.workforce_staff_is_mine(staff_id))
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
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
)
WITH CHECK (
  public.workforce_can_edit_date(work_date)
  AND public.workforce_staff_org(staff_id) = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
);

DROP POLICY IF EXISTS "workforce notes" ON public.workforce_staff_notes;
CREATE POLICY "workforce notes" ON public.workforce_staff_notes FOR ALL TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
)
WITH CHECK (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND public.workforce_staff_org(staff_id) = organization_slug
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
);

-- Import: every company-level role (admin, top management, HR, super admin).
DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('public.workforce_import(jsonb, boolean, text)'::regprocedure) INTO src;
  src := replace(src,
    $r$IF actor IS NULL OR actor.access_level <> 'org' OR actor.role NOT IN ('admin', 'hr') THEN$r$,
    $r$IF actor IS NULL OR actor.access_level <> 'org' THEN$r$);
  src := replace(src, 'Only administrators and HR can import a schedule workbook',
                      'Only administrators, top management and HR can import a schedule workbook');
  EXECUTE src;
END $$;
