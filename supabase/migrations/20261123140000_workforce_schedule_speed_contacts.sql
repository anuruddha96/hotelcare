-- Work schedule: faster loading, and contact details on the employee record.
--
-- 1. Loading a month took 1.5-2 s per request because the "write entries"
--    policy (FOR ALL, so it also runs on reads) called the plpgsql function
--    workforce_can_edit_date() once per row. The first editable date is the
--    same for every row of a statement, so it is now computed once.
--    The rule itself is unchanged: company-level planners may change days
--    from the first day of last month, hotel-level planners from today.
-- 2. Phone and e-mail on workforce_staff, so managers can keep an employee's
--    contact details next to their schedule. Additive.

CREATE OR REPLACE FUNCTION public.workforce_first_editable_date()
RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  today date := (timezone('Europe/Budapest', now()))::date;
  actor record;
BEGIN
  SELECT * INTO actor FROM public.workforce_access() LIMIT 1;
  IF actor IS NULL OR actor.access_level = 'self' THEN RETURN NULL; END IF;
  IF actor.access_level = 'org' THEN
    RETURN (date_trunc('month', today) - interval '1 month')::date;
  END IF;
  RETURN today;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_first_editable_date() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_first_editable_date() TO authenticated, service_role;

-- Same answer as before, now through the shared helper.
CREATE OR REPLACE FUNCTION public.workforce_can_edit_date(_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT COALESCE(_date >= public.workforce_first_editable_date(), false) $$;

DROP POLICY IF EXISTS "workforce write entries" ON public.workforce_entries;
CREATE POLICY "workforce write entries" ON public.workforce_entries FOR ALL TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND work_date >= (SELECT public.workforce_first_editable_date())
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
)
WITH CHECK (
  work_date >= (SELECT public.workforce_first_editable_date())
  AND public.workforce_staff_org(staff_id) = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
);

ALTER TABLE public.workforce_staff ADD COLUMN IF NOT EXISTS phone text
  CHECK (phone IS NULL OR char_length(phone) <= 40);
ALTER TABLE public.workforce_staff ADD COLUMN IF NOT EXISTS email text
  CHECK (email IS NULL OR char_length(email) <= 200);
COMMENT ON COLUMN public.workforce_staff.phone IS 'Contact phone, entered by HR or the manager. Visible to planners only.';
COMMENT ON COLUMN public.workforce_staff.email IS 'Contact e-mail, entered by HR or the manager. Visible to planners only.';
