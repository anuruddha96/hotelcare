-- DRAFT RD HOTELS PILOT ONLY. Never apply to production before authenticated RLS/RPC UAT.
-- A single JSON request is one transaction: any error rolls back every change.
-- Import creates/updates DRAFT rows only. Published rows are immutable, even when
-- a spreadsheet differs. Absence in Excel never deletes an existing shift.
CREATE TABLE public.work_schedule_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL DEFAULT 'rdhotels' CHECK (organization_slug = 'rdhotels'),
  hotel_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  requested_count integer NOT NULL CHECK (requested_count BETWEEN 1 AND 6000),
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.work_schedule_import_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_schedule_import_runs FROM PUBLIC, anon, authenticated;
-- The authenticated browser must not directly read audit/run details or write tables.

CREATE FUNCTION public.work_schedule_import_excel_drafts(p_hotel_id text, p_entries jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row jsonb;
  v_staff uuid;
  v_label text;
  v_date date;
  v_slot smallint;
  v_kind text;
  v_start time without time zone;
  v_end time without time zone;
  v_offset smallint;
  v_break integer;
  v_expected integer;
  v_old public.work_schedule_entries%ROWTYPE;
  v_new public.work_schedule_entries%ROWTYPE;
  v_seen jsonb := '{}'::jsonb;
  v_key text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_run uuid := gen_random_uuid();
  v_duration integer;
BEGIN
  IF NOT public.work_schedule_can_manage(p_hotel_id) THEN
    RAISE EXCEPTION 'Schedule import is not permitted for this venue' USING ERRCODE = '42501';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array'
     OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 6000 THEN
    RAISE EXCEPTION 'Import requires 1 to 6000 reviewed shifts';
  END IF;
  -- Serialize competing imports at this venue, in addition to row-level version locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('rd-work-schedule/' || p_hotel_id, 0));
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    IF jsonb_typeof(v_row) <> 'object' OR jsonb_typeof(v_row->'staff_id') <> 'string'
       OR jsonb_typeof(v_row->'source_label') <> 'string'
       OR jsonb_typeof(v_row->'shift_date') <> 'string'
       OR jsonb_typeof(v_row->'slot') <> 'number'
       OR jsonb_typeof(v_row->'kind') <> 'string'
       OR jsonb_typeof(v_row->'end_day_offset') <> 'number'
       OR jsonb_typeof(v_row->'unpaid_break_minutes') <> 'number'
       OR (v_row ? 'expected_version' AND jsonb_typeof(v_row->'expected_version') NOT IN ('number','null')) THEN
      RAISE EXCEPTION 'Malformed reviewed schedule row';
    END IF;
    v_staff := (v_row->>'staff_id')::uuid;
    v_label := btrim(v_row->>'source_label');
    v_date := (v_row->>'shift_date')::date;
    v_slot := (v_row->>'slot')::smallint;
    v_kind := v_row->>'kind';
    v_offset := (v_row->>'end_day_offset')::smallint;
    v_break := (v_row->>'unpaid_break_minutes')::integer;
    v_expected := CASE WHEN v_row->>'expected_version' IS NULL THEN NULL
                   ELSE (v_row->>'expected_version')::integer END;
    v_start := CASE WHEN jsonb_typeof(v_row->'start_local') = 'string'
                   THEN (v_row->>'start_local')::time ELSE NULL END;
    v_end := CASE WHEN jsonb_typeof(v_row->'end_local') = 'string'
                   THEN (v_row->>'end_local')::time ELSE NULL END;
    IF v_staff IS NULL OR length(v_label) NOT BETWEEN 1 AND 180
       OR v_label ~ '[[:cntrl:]]' OR v_date IS NULL
       OR v_date NOT BETWEEN DATE '2020-01-01' AND DATE '2037-12-31'
       OR v_slot NOT BETWEEN 1 AND 4 OR v_kind NOT IN ('work','off','leave','training','unavailable')
       OR v_offset NOT IN (0,1) OR v_break NOT BETWEEN 0 AND 240
       OR (v_expected IS NOT NULL AND v_expected < 1) THEN
      RAISE EXCEPTION 'Invalid reviewed schedule values';
    END IF;
    -- A mapping must have been explicitly confirmed in the database; a forged
    -- client payload cannot pick a different employee or a different venue.
    IF NOT EXISTS (
      SELECT 1 FROM public.work_schedule_employee_links l
      JOIN public.profiles staff ON staff.id = l.staff_id
      JOIN public.hotel_configurations hotel ON hotel.hotel_id = l.hotel_id
      JOIN public.organizations org ON org.id = hotel.organization_id
      WHERE l.hotel_id = p_hotel_id AND l.organization_slug = 'rdhotels'
        AND lower(btrim(l.source_label)) = lower(v_label) AND l.staff_id = v_staff
        AND staff.organization_slug = 'rdhotels' AND org.slug = 'rdhotels'
        AND (staff.assigned_hotel IN (hotel.hotel_id, hotel.hotel_name)
             OR staff.hotel_id = hotel.hotel_id)
    ) THEN
      RAISE EXCEPTION 'Excel employee is not linked to an authorized HotelCare account for this venue'
        USING ERRCODE = '42501';
    END IF;
    IF v_kind = 'work' THEN
      IF v_start IS NULL OR v_end IS NULL OR (v_offset = 0 AND v_end <= v_start)
         OR (v_offset = 1 AND v_end >= v_start) THEN
        RAISE EXCEPTION 'Invalid shift interval or ambiguous overnight shift';
      END IF;
      v_duration := (EXTRACT(EPOCH FROM (v_end - v_start)) / 60)::integer + 1440 * v_offset;
      IF v_duration <= v_break OR v_duration > 1440 THEN
        RAISE EXCEPTION 'Unpaid break exceeds shift or shift exceeds 24 hours';
      END IF;
    ELSIF v_start IS NOT NULL OR v_end IS NOT NULL OR v_offset <> 0 OR v_break <> 0 THEN
      RAISE EXCEPTION 'Non-working schedule row cannot carry working hours';
    END IF;
    v_key := v_staff::text || '/' || v_date::text || '/' || v_slot::text;
    IF v_seen ? v_key THEN
      RAISE EXCEPTION 'Repeated employee/date/slot in Excel payload: %', v_date;
    END IF;
    v_seen := jsonb_set(v_seen, ARRAY[v_key], 'true'::jsonb);

    SELECT * INTO v_old FROM public.work_schedule_entries
      WHERE organization_slug = 'rdhotels' AND hotel_id = p_hotel_id
        AND staff_id = v_staff AND shift_date = v_date AND slot = v_slot FOR UPDATE;
    IF FOUND THEN
      IF v_expected IS NULL OR v_old.version <> v_expected THEN
        RAISE EXCEPTION 'Roster changed since Excel preview; refresh and review before retrying'
          USING ERRCODE = '40001';
      END IF;
      IF v_old.kind = v_kind AND v_old.start_local IS NOT DISTINCT FROM v_start
         AND v_old.end_local IS NOT DISTINCT FROM v_end
         AND v_old.end_day_offset = v_offset AND v_old.unpaid_break_minutes = v_break THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;
      IF v_old.state = 'published' THEN
        RAISE EXCEPTION 'Excel conflicts with a published shift; do not overwrite a notified roster'
          USING ERRCODE = '40001';
      END IF;
      UPDATE public.work_schedule_entries
         SET kind = v_kind, start_local = v_start, end_local = v_end,
             end_day_offset = v_offset, unpaid_break_minutes = v_break,
             source = 'xlsx', version = version + 1, updated_by = auth.uid(), updated_at = now()
       WHERE id = v_old.id RETURNING * INTO v_new;
      INSERT INTO public.work_schedule_events(entry_id, actor_id, event_kind, before_data, after_data)
        VALUES(v_new.id, auth.uid(), 'edit', to_jsonb(v_old), to_jsonb(v_new));
      v_updated := v_updated + 1;
    ELSE
      IF v_expected IS NOT NULL THEN
        RAISE EXCEPTION 'A previously previewed shift disappeared; refresh before importing'
          USING ERRCODE = '40001';
      END IF;
      INSERT INTO public.work_schedule_entries(hotel_id, staff_id, shift_date, slot, kind,
        start_local, end_local, end_day_offset, unpaid_break_minutes,
        note, state, source, created_by, updated_by)
      VALUES(p_hotel_id, v_staff, v_date, v_slot, v_kind,
        v_start, v_end, v_offset, v_break,
        '', 'draft', 'xlsx', auth.uid(), auth.uid()) RETURNING * INTO v_new;
      INSERT INTO public.work_schedule_events(entry_id, actor_id, event_kind, before_data, after_data)
        VALUES(v_new.id, auth.uid(), 'create', NULL, to_jsonb(v_new));
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  INSERT INTO public.work_schedule_import_runs(id,hotel_id,actor_id,requested_count,
      inserted_count,updated_count,unchanged_count)
    VALUES(v_run,p_hotel_id,auth.uid(),jsonb_array_length(p_entries),
      v_inserted,v_updated,v_unchanged);
  RETURN jsonb_build_object('batch_id',v_run,'inserted',v_inserted,
      'updated',v_updated,'unchanged',v_unchanged,'state','draft');
END;
$$;
REVOKE ALL ON FUNCTION public.work_schedule_import_excel_drafts(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_schedule_import_excel_drafts(text,jsonb) TO authenticated;
