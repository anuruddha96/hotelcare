-- SLNT-only scheduling security. Do not change RD Hotels or shared housekeeping semantics.
-- Scheduling writes go through transaction-atomic RPCs; RLS also guards direct REST access.

CREATE OR REPLACE FUNCTION public.slnt_schedule_row_allowed(
  _organization text, _hotel text, _employee uuid, _schedule uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles actor
    JOIN public.organizations organization ON organization.slug = actor.organization_slug
    JOIN public.hotel_configurations hotel
      ON hotel.hotel_id = _hotel AND hotel.organization_id = organization.id
    JOIN public.profiles employee ON employee.id = _employee
    WHERE actor.id = auth.uid()
      AND actor.deleted_at IS NULL
      AND actor.organization_slug = 'slnt' AND _organization = 'slnt'
      AND actor.role::text IN ('admin','top_management','top_management_manager','manager','housekeeping_manager','hr')
      AND public.user_can_access_hotel(actor.id, _hotel)
      AND employee.deleted_at IS NULL
      AND employee.organization_slug = actor.organization_slug
      AND (employee.assigned_hotel IN (hotel.hotel_id, hotel.hotel_name)
           OR employee.hotel_id = hotel.hotel_id)
      AND (
        actor.role::text IN ('admin','top_management','top_management_manager')
        OR NOT EXISTS (
          SELECT 1 FROM public.user_property_scopes own
          JOIN public.venues own_venue ON own_venue.id = own.venue_id
          WHERE own.user_id = actor.id AND own.organization_slug = 'slnt'
            AND own_venue.organization_slug = 'slnt' AND own_venue.hotel_id = _hotel
        )
        OR (
          EXISTS (
            SELECT 1 FROM public.user_property_scopes mine
            JOIN public.user_property_scopes theirs ON theirs.venue_id = mine.venue_id
            JOIN public.venues shared_venue ON shared_venue.id = mine.venue_id
            WHERE mine.user_id = actor.id AND mine.organization_slug = 'slnt'
              AND theirs.user_id = employee.id AND theirs.organization_slug = 'slnt'
              AND shared_venue.hotel_id = _hotel AND shared_venue.organization_slug = 'slnt'
          )
          AND (
            _schedule IS NULL OR NOT EXISTS (
              SELECT 1 FROM public.staff_schedule_venues link
              WHERE link.schedule_id = _schedule
                AND NOT EXISTS (
                  SELECT 1 FROM public.user_property_scopes scope
                  WHERE scope.user_id = actor.id AND scope.organization_slug = 'slnt'
                    AND scope.venue_id = link.venue_id
                )
            )
          )
        )
      )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.slnt_schedule_venue_allowed(
  _schedule uuid, _venue uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_schedules schedule
    JOIN public.venues venue ON venue.id = _venue
    WHERE schedule.id = _schedule AND schedule.organization_slug = 'slnt'
      AND venue.organization_slug = schedule.organization_slug
      AND venue.hotel_id = schedule.hotel_id AND venue.is_active
      AND public.slnt_schedule_row_allowed(schedule.organization_slug, schedule.hotel_id, schedule.user_id, schedule.id)
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.user_property_scopes scope
          JOIN public.venues scoped_venue ON scoped_venue.id = scope.venue_id
          WHERE scope.user_id = auth.uid() AND scope.organization_slug = 'slnt'
            AND scoped_venue.hotel_id = schedule.hotel_id
        ) OR EXISTS (
          SELECT 1 FROM public.user_property_scopes scope
          WHERE scope.user_id = auth.uid() AND scope.organization_slug = 'slnt'
            AND scope.venue_id = _venue
        )
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.user_property_scopes scope
          WHERE scope.user_id = schedule.user_id AND scope.organization_slug = 'slnt'
        ) OR EXISTS (
          SELECT 1 FROM public.user_property_scopes scope
          WHERE scope.user_id = schedule.user_id AND scope.organization_slug = 'slnt'
            AND scope.venue_id = _venue
        )
      )
  );
$fn$;

-- Replace the original hotel-wide policies; a scoped manager may neither read nor
-- mutate another venue's shifts using direct REST, including forged payloads.
DROP POLICY IF EXISTS "SLNT schedule managers create accessible schedules" ON public.staff_schedules;
DROP POLICY IF EXISTS "SLNT schedule managers delete accessible schedules" ON public.staff_schedules;
DROP POLICY IF EXISTS "SLNT schedule managers update accessible schedules" ON public.staff_schedules;
DROP POLICY IF EXISTS "SLNT schedule managers view accessible schedules" ON public.staff_schedules;
DROP POLICY IF EXISTS "SLNT staff view own published schedules" ON public.staff_schedules;

CREATE POLICY "SLNT schedule managers create accessible schedules" ON public.staff_schedules FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.slnt_schedule_row_allowed(organization_slug, hotel_id, user_id));
CREATE POLICY "SLNT schedule managers delete accessible schedules" ON public.staff_schedules FOR DELETE TO authenticated
USING (public.slnt_schedule_row_allowed(organization_slug, hotel_id, user_id, id));
CREATE POLICY "SLNT schedule managers update accessible schedules" ON public.staff_schedules FOR UPDATE TO authenticated
USING (public.slnt_schedule_row_allowed(organization_slug, hotel_id, user_id, id))
WITH CHECK (public.slnt_schedule_row_allowed(organization_slug, hotel_id, user_id, id));
CREATE POLICY "SLNT schedule managers view accessible schedules" ON public.staff_schedules FOR SELECT TO authenticated
USING (public.slnt_schedule_row_allowed(organization_slug, hotel_id, user_id, id));
CREATE POLICY "SLNT staff view own published schedules" ON public.staff_schedules FOR SELECT TO authenticated
USING (user_id = auth.uid() AND status = 'published' AND organization_slug = 'slnt'
  AND EXISTS (SELECT 1 FROM public.profiles employee WHERE employee.id = auth.uid()
    AND employee.deleted_at IS NULL AND employee.organization_slug = staff_schedules.organization_slug));

DROP POLICY IF EXISTS "SLNT schedule managers create shift venues" ON public.staff_schedule_venues;
DROP POLICY IF EXISTS "SLNT schedule managers delete shift venues" ON public.staff_schedule_venues;
DROP POLICY IF EXISTS "SLNT schedule managers update shift venues" ON public.staff_schedule_venues;
DROP POLICY IF EXISTS "SLNT schedule managers view shift venues" ON public.staff_schedule_venues;
DROP POLICY IF EXISTS "SLNT staff view venues for own published shifts" ON public.staff_schedule_venues;

CREATE POLICY "SLNT schedule managers create shift venues" ON public.staff_schedule_venues FOR INSERT TO authenticated
WITH CHECK (public.slnt_schedule_venue_allowed(schedule_id, venue_id));
CREATE POLICY "SLNT schedule managers delete shift venues" ON public.staff_schedule_venues FOR DELETE TO authenticated
USING (public.slnt_schedule_venue_allowed(schedule_id, venue_id));
CREATE POLICY "SLNT schedule managers update shift venues" ON public.staff_schedule_venues FOR UPDATE TO authenticated
USING (public.slnt_schedule_venue_allowed(schedule_id, venue_id))
WITH CHECK (public.slnt_schedule_venue_allowed(schedule_id, venue_id));
CREATE POLICY "SLNT schedule managers view shift venues" ON public.staff_schedule_venues FOR SELECT TO authenticated
USING (public.slnt_schedule_venue_allowed(schedule_id, venue_id));
CREATE POLICY "SLNT staff view venues for own published shifts" ON public.staff_schedule_venues FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.staff_schedules schedule
  JOIN public.profiles employee ON employee.id = auth.uid()
  WHERE schedule.id = schedule_id AND schedule.user_id = auth.uid()
    AND schedule.organization_slug = 'slnt' AND employee.organization_slug = 'slnt'
    AND employee.deleted_at IS NULL AND schedule.status = 'published'
));

-- One database transaction for shift, venue links and publication. A failed venue
-- write rolls the entire request back rather than leaving a misleading shift.
CREATE OR REPLACE FUNCTION public.slnt_save_staff_shift(
  _hotel text, _employee uuid, _date date, _start time without time zone,
  _end time without time zone, _status text, _notes text, _venues uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  _id uuid;
  _venue uuid;
  _actor_scoped boolean;
  _employee_scoped boolean;
BEGIN
  IF auth.uid() IS NULL OR _hotel IS NULL OR _employee IS NULL OR _date IS NULL
    OR _start IS NULL OR _end IS NULL OR _end <= _start
    OR _status NOT IN ('draft','published','off') OR _status IS NULL
    OR length(coalesce(_notes,'')) > 500 OR cardinality(coalesce(_venues,ARRAY[]::uuid[])) > 50
    OR (_status <> 'off' AND cardinality(coalesce(_venues,ARRAY[]::uuid[])) = 0)
    OR (_status = 'off' AND cardinality(coalesce(_venues,ARRAY[]::uuid[])) <> 0)
  THEN RAISE EXCEPTION 'Invalid shift details' USING ERRCODE = '22023'; END IF;
  SELECT id INTO _id FROM public.staff_schedules
  WHERE organization_slug = 'slnt' AND hotel_id = _hotel
    AND user_id = _employee AND work_date = _date FOR UPDATE;
  IF NOT public.slnt_schedule_row_allowed('slnt',_hotel,_employee,_id) THEN
    RAISE EXCEPTION 'Not authorized for this employee or venue' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.user_property_scopes scope
    JOIN public.venues venue ON venue.id = scope.venue_id
    WHERE scope.user_id = auth.uid() AND scope.organization_slug = 'slnt'
      AND venue.hotel_id = _hotel) INTO _actor_scoped;
  SELECT EXISTS (SELECT 1 FROM public.user_property_scopes scope
    WHERE scope.user_id = _employee AND scope.organization_slug = 'slnt') INTO _employee_scoped;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(_venues,ARRAY[]::uuid[])) AS item(venue_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.venues venue
      WHERE venue.id = item.venue_id AND venue.organization_slug = 'slnt'
        AND venue.hotel_id = _hotel AND venue.is_active
        AND (NOT _actor_scoped OR EXISTS (SELECT 1 FROM public.user_property_scopes scope
          WHERE scope.user_id = auth.uid() AND scope.organization_slug = 'slnt' AND scope.venue_id = venue.id))
        AND (NOT _employee_scoped OR EXISTS (SELECT 1 FROM public.user_property_scopes scope
          WHERE scope.user_id = _employee AND scope.organization_slug = 'slnt' AND scope.venue_id = venue.id))))
  THEN RAISE EXCEPTION 'A venue is outside the permitted hotel or employee scope' USING ERRCODE = '42501'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.staff_schedules (organization_slug,hotel_id,user_id,work_date,shift_start,shift_end,status,notes,created_by)
    VALUES ('slnt',_hotel,_employee,_date,_start,_end,'draft',nullif(trim(_notes),''),auth.uid())
    RETURNING id INTO _id;
  ELSE
    UPDATE public.staff_schedules SET shift_start=_start,shift_end=_end,notes=nullif(trim(_notes),'')
    WHERE id=_id;
  END IF;
  DELETE FROM public.staff_schedule_venues WHERE schedule_id=_id;
  INSERT INTO public.staff_schedule_venues(schedule_id,venue_id)
  SELECT _id, item.venue_id FROM unnest(coalesce(_venues,ARRAY[]::uuid[])) AS item(venue_id)
  WHERE item.venue_id IS NOT NULL GROUP BY item.venue_id;
  UPDATE public.staff_schedules SET status=_status,
    published_at=CASE WHEN _status='published' THEN now() ELSE NULL END,
    published_by=CASE WHEN _status='published' THEN auth.uid() ELSE NULL END
  WHERE id=_id;
  RETURN _id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.slnt_publish_staff_week(
  _hotel text, _from date, _ids uuid[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  _shift record;
  _count integer := 0;
BEGIN
  IF auth.uid() IS NULL OR _hotel IS NULL OR _from IS NULL OR
     cardinality(coalesce(_ids,ARRAY[]::uuid[])) = 0 OR cardinality(_ids) > 1000 THEN
    RAISE EXCEPTION 'Invalid publish request' USING ERRCODE='22023'; END IF;
  FOR _shift IN SELECT * FROM public.staff_schedules
    WHERE id = ANY(_ids) FOR UPDATE LOOP
    IF _shift.organization_slug <> 'slnt' OR _shift.hotel_id <> _hotel
      OR _shift.work_date < _from OR _shift.work_date > (_from+6)
      OR _shift.status <> 'draft'
      OR NOT public.slnt_schedule_row_allowed('slnt', _hotel, _shift.user_id, _shift.id)
      OR NOT EXISTS (SELECT 1 FROM public.staff_schedule_venues link WHERE link.schedule_id=_shift.id)
    THEN RAISE EXCEPTION 'Invalid or unauthorized shift in publish request' USING ERRCODE='42501'; END IF;
    _count := _count+1;
  END LOOP;
  IF _count <> (SELECT count(DISTINCT id) FROM unnest(_ids) AS selected(id)) THEN
    RAISE EXCEPTION 'One or more shifts no longer exist or are inaccessible' USING ERRCODE='42501'; END IF;
  UPDATE public.staff_schedules SET status='published', published_at=now(),published_by=auth.uid()
  WHERE id=ANY(_ids) AND organization_slug='slnt' AND hotel_id=_hotel;
  RETURN _count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.slnt_save_staff_shift(text,uuid,date,time without time zone,time without time zone,text,text,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_save_staff_shift(text,uuid,date,time without time zone,time without time zone,text,text,uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.slnt_publish_staff_week(text,date,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_publish_staff_week(text,date,uuid[]) TO authenticated;
