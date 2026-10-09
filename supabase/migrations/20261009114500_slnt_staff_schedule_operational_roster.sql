-- SLNT staff schedule operational roster tools.
-- Adds reusable default rosters and atomic Excel-like bulk paste without changing RD Hotels.

CREATE TABLE IF NOT EXISTS public.slnt_staff_roster_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL DEFAULT 'slnt' CHECK (organization_slug = 'slnt'),
  hotel_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  iso_weekday smallint NOT NULL CHECK (iso_weekday BETWEEN 1 AND 7),
  shift_start time without time zone NOT NULL DEFAULT '09:00',
  shift_end time without time zone NOT NULL DEFAULT '17:00',
  is_working boolean NOT NULL DEFAULT true,
  venue_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slnt_staff_roster_templates_employee_day_unique
    UNIQUE (organization_slug, hotel_id, user_id, iso_weekday),
  CONSTRAINT slnt_staff_roster_templates_shift_valid CHECK (shift_end > shift_start),
  CONSTRAINT slnt_staff_roster_templates_notes_valid CHECK (length(coalesce(notes, '')) <= 500),
  CONSTRAINT slnt_staff_roster_templates_venues_valid CHECK (cardinality(venue_ids) <= 50),
  CONSTRAINT slnt_staff_roster_templates_working_venues_valid CHECK (
    (is_working AND cardinality(venue_ids) > 0)
    OR (NOT is_working AND cardinality(venue_ids) = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_slnt_staff_roster_templates_hotel_user
  ON public.slnt_staff_roster_templates (hotel_id, user_id);

ALTER TABLE public.slnt_staff_roster_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SLNT managers view roster templates" ON public.slnt_staff_roster_templates;
CREATE POLICY "SLNT managers view roster templates"
ON public.slnt_staff_roster_templates
FOR SELECT TO authenticated
USING (
  organization_slug = 'slnt'
  AND public.slnt_schedule_row_allowed(organization_slug, hotel_id, user_id, NULL)
);

REVOKE ALL ON public.slnt_staff_roster_templates FROM anon, authenticated;
GRANT SELECT ON public.slnt_staff_roster_templates TO authenticated;

CREATE OR REPLACE FUNCTION public.slnt_replace_staff_roster_template(
  _hotel text,
  _employee uuid,
  _days jsonb,
  _venues uuid[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _entry jsonb;
  _weekday integer;
  _working boolean;
  _start time without time zone;
  _end time without time zone;
  _notes text;
  _count integer := 0;
  _actor_scoped boolean;
  _employee_scoped boolean;
  _clean_venues uuid[];
BEGIN
  IF auth.uid() IS NULL
    OR _hotel IS NULL
    OR _employee IS NULL
    OR _days IS NULL
    OR jsonb_typeof(_days) <> 'array'
    OR jsonb_array_length(_days) <> 7
    OR cardinality(coalesce(_venues, ARRAY[]::uuid[])) > 50
    OR NOT public.can_manage_slnt_schedule(_hotel)
    OR NOT public.slnt_schedule_row_allowed('slnt', _hotel, _employee, NULL)
  THEN
    RAISE EXCEPTION 'Invalid or unauthorized roster template request' USING ERRCODE = '42501';
  END IF;

  IF (
    SELECT count(DISTINCT (item->>'iso_weekday')::integer)
    FROM jsonb_array_elements(_days) AS item
  ) <> 7
  OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(_days) AS item
    WHERE (item->>'iso_weekday')::integer NOT BETWEEN 1 AND 7
  )
  THEN
    RAISE EXCEPTION 'Roster template must include each weekday exactly once' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT venue_id
    FROM unnest(coalesce(_venues, ARRAY[]::uuid[])) AS venue_id
    WHERE venue_id IS NOT NULL
    ORDER BY venue_id
  ) INTO _clean_venues;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_property_scopes scope
    JOIN public.venues venue ON venue.id = scope.venue_id
    WHERE scope.user_id = auth.uid()
      AND scope.organization_slug = 'slnt'
      AND venue.hotel_id = _hotel
  ) INTO _actor_scoped;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_property_scopes scope
    WHERE scope.user_id = _employee
      AND scope.organization_slug = 'slnt'
  ) INTO _employee_scoped;

  IF EXISTS (
    SELECT 1
    FROM unnest(coalesce(_clean_venues, ARRAY[]::uuid[])) AS candidate(venue_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.venues venue
      WHERE venue.id = candidate.venue_id
        AND venue.organization_slug = 'slnt'
        AND venue.hotel_id = _hotel
        AND venue.is_active
        AND (
          NOT _actor_scoped
          OR EXISTS (
            SELECT 1
            FROM public.user_property_scopes scope
            WHERE scope.user_id = auth.uid()
              AND scope.organization_slug = 'slnt'
              AND scope.venue_id = venue.id
          )
        )
        AND (
          NOT _employee_scoped
          OR EXISTS (
            SELECT 1
            FROM public.user_property_scopes scope
            WHERE scope.user_id = _employee
              AND scope.organization_slug = 'slnt'
              AND scope.venue_id = venue.id
          )
        )
    )
  ) THEN
    RAISE EXCEPTION 'A default roster venue is outside the permitted scope' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.slnt_staff_roster_templates
  WHERE organization_slug = 'slnt'
    AND hotel_id = _hotel
    AND user_id = _employee;

  FOR _entry IN SELECT value FROM jsonb_array_elements(_days)
  LOOP
    _weekday := (_entry->>'iso_weekday')::integer;
    _working := coalesce((_entry->>'is_working')::boolean, false);
    _start := coalesce(nullif(_entry->>'shift_start', '')::time, '09:00'::time);
    _end := coalesce(nullif(_entry->>'shift_end', '')::time, '17:00'::time);
    _notes := nullif(trim(coalesce(_entry->>'notes', '')), '');

    IF _end <= _start
      OR length(coalesce(_notes, '')) > 500
      OR (_working AND cardinality(coalesce(_clean_venues, ARRAY[]::uuid[])) = 0)
    THEN
      RAISE EXCEPTION 'Invalid default roster day' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.slnt_staff_roster_templates (
      organization_slug, hotel_id, user_id, iso_weekday,
      shift_start, shift_end, is_working, venue_ids, notes, created_by
    ) VALUES (
      'slnt', _hotel, _employee, _weekday,
      _start, _end, _working,
      CASE WHEN _working THEN _clean_venues ELSE ARRAY[]::uuid[] END,
      _notes, auth.uid()
    );
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.slnt_apply_staff_roster_template(
  _hotel text,
  _employee uuid,
  _from date,
  _weeks integer DEFAULT 6
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _template record;
  _date date;
  _offset integer;
  _generated integer := 0;
  _skipped integer := 0;
BEGIN
  IF auth.uid() IS NULL
    OR _hotel IS NULL
    OR _employee IS NULL
    OR _from IS NULL
    OR _weeks NOT BETWEEN 1 AND 8
    OR NOT public.can_manage_slnt_schedule(_hotel)
    OR NOT public.slnt_schedule_row_allowed('slnt', _hotel, _employee, NULL)
  THEN
    RAISE EXCEPTION 'Invalid or unauthorized roster generation request' USING ERRCODE = '42501';
  END IF;

  FOR _offset IN 0..((_weeks * 7) - 1)
  LOOP
    _date := _from + _offset;

    SELECT *
    INTO _template
    FROM public.slnt_staff_roster_templates template
    WHERE template.organization_slug = 'slnt'
      AND template.hotel_id = _hotel
      AND template.user_id = _employee
      AND template.iso_weekday = extract(isodow FROM _date)::integer;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.staff_schedules schedule
      WHERE schedule.organization_slug = 'slnt'
        AND schedule.hotel_id = _hotel
        AND schedule.user_id = _employee
        AND schedule.work_date = _date
    ) THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    PERFORM public.slnt_save_staff_shift(
      _hotel,
      _employee,
      _date,
      _template.shift_start,
      _template.shift_end,
      CASE WHEN _template.is_working THEN 'draft' ELSE 'off' END,
      coalesce(_template.notes, ''),
      CASE WHEN _template.is_working THEN _template.venue_ids ELSE ARRAY[]::uuid[] END
    );
    _generated := _generated + 1;
  END LOOP;

  RETURN jsonb_build_object('generated', _generated, 'skipped_existing', _skipped);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.slnt_bulk_apply_staff_shifts(
  _hotel text,
  _items jsonb,
  _overwrite_published boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  _item jsonb;
  _employee uuid;
  _date date;
  _start time without time zone;
  _end time without time zone;
  _status text;
  _notes text;
  _venues uuid[];
  _existing_status text;
  _applied integer := 0;
  _skipped_published integer := 0;
BEGIN
  IF auth.uid() IS NULL
    OR _hotel IS NULL
    OR _items IS NULL
    OR jsonb_typeof(_items) <> 'array'
    OR jsonb_array_length(_items) = 0
    OR jsonb_array_length(_items) > 200
    OR NOT public.can_manage_slnt_schedule(_hotel)
  THEN
    RAISE EXCEPTION 'Invalid or unauthorized bulk schedule request' USING ERRCODE = '42501';
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_items)
  LOOP
    _employee := (_item->>'employee')::uuid;
    _date := (_item->>'date')::date;
    _start := (_item->>'start')::time;
    _end := (_item->>'end')::time;
    _status := coalesce(_item->>'status', 'draft');
    _notes := coalesce(_item->>'notes', '');

    SELECT ARRAY(
      SELECT DISTINCT value::uuid
      FROM jsonb_array_elements_text(coalesce(_item->'venues', '[]'::jsonb)) AS value
      ORDER BY value::uuid
    ) INTO _venues;

    IF _status NOT IN ('draft', 'off') THEN
      RAISE EXCEPTION 'Pasted shifts may only be drafts or days off' USING ERRCODE = '22023';
    END IF;

    SELECT status
    INTO _existing_status
    FROM public.staff_schedules
    WHERE organization_slug = 'slnt'
      AND hotel_id = _hotel
      AND user_id = _employee
      AND work_date = _date
    FOR UPDATE;

    IF _existing_status = 'published' AND NOT _overwrite_published THEN
      _skipped_published := _skipped_published + 1;
      CONTINUE;
    END IF;

    PERFORM public.slnt_save_staff_shift(
      _hotel,
      _employee,
      _date,
      _start,
      _end,
      _status,
      _notes,
      CASE WHEN _status = 'off' THEN ARRAY[]::uuid[] ELSE _venues END
    );
    _applied := _applied + 1;
    _existing_status := NULL;
  END LOOP;

  RETURN jsonb_build_object(
    'applied', _applied,
    'skipped_published', _skipped_published
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.slnt_replace_staff_roster_template(text,uuid,jsonb,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_replace_staff_roster_template(text,uuid,jsonb,uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.slnt_apply_staff_roster_template(text,uuid,date,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_apply_staff_roster_template(text,uuid,date,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.slnt_bulk_apply_staff_shifts(text,jsonb,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_bulk_apply_staff_shifts(text,jsonb,boolean) TO authenticated;
