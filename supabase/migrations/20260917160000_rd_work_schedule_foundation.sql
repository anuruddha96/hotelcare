-- RD Hotels pilot only. Additive: do NOT apply to production before UAT and privacy review.
-- Planned roster entries never alter the existing attendance, payroll or housekeeping tables.
CREATE TABLE public.work_schedule_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL DEFAULT 'rdhotels' CHECK (organization_slug = 'rdhotels'),
  hotel_id text NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.profiles(id),
  shift_date date NOT NULL,
  slot smallint NOT NULL DEFAULT 1 CHECK (slot BETWEEN 1 AND 4),
  kind text NOT NULL CHECK (kind IN ('work','off','leave','training','unavailable')),
  start_local time without time zone,
  end_local time without time zone,
  end_day_offset smallint NOT NULL DEFAULT 0 CHECK (end_day_offset IN (0,1)),
  unpaid_break_minutes integer NOT NULL DEFAULT 0 CHECK (unpaid_break_minutes BETWEEN 0 AND 240),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','xlsx')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  updated_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_slug, hotel_id, staff_id, shift_date, slot),
  CHECK ((kind = 'work' AND start_local IS NOT NULL AND end_local IS NOT NULL
      AND (end_day_offset = 1 OR end_local > start_local))
    OR (kind <> 'work' AND start_local IS NULL AND end_local IS NULL
      AND end_day_offset = 0 AND unpaid_break_minutes = 0))
);
CREATE INDEX work_schedule_hotel_month ON public.work_schedule_entries(organization_slug, hotel_id, shift_date);
CREATE INDEX work_schedule_staff_month ON public.work_schedule_entries(staff_id, shift_date) WHERE state = 'published';

CREATE TABLE public.work_schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.work_schedule_entries(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  event_kind text NOT NULL CHECK (event_kind IN ('create','edit','publish')),
  before_data jsonb,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.work_schedule_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_schedule_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_schedule_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.work_schedule_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.work_schedule_entries TO authenticated;

-- Venue authorization checks the authenticated, persisted profile and the
-- hotel's owner. Legacy profiles contain either an ID or that hotel's exact
-- registered display name, never a fuzzy alias or a browser-provided name.
CREATE OR REPLACE FUNCTION public.work_schedule_can_manage(p_hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.profiles actor
   JOIN public.hotel_configurations h ON h.hotel_id = p_hotel_id
   JOIN public.organizations org ON org.id = h.organization_id
   WHERE actor.id = auth.uid() AND actor.organization_slug = org.slug
     AND org.slug = 'rdhotels'
     AND (
       actor.role::text IN ('admin','hr')
       OR (actor.role::text IN ('manager','top_management','top_management_manager',
          'housekeeping_manager','maintenance_manager','reception_manager',
          'back_office_manager','control_manager','finance_manager','marketing_manager')
          AND actor.assigned_hotel IN (h.hotel_id,h.hotel_name))
     )
 );
$$;
REVOKE ALL ON FUNCTION public.work_schedule_can_manage(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_schedule_can_manage(text) TO authenticated;

CREATE POLICY "Employee published own schedule or venue manager schedule"
ON public.work_schedule_entries FOR SELECT TO authenticated USING (
 organization_slug = 'rdhotels' AND (
   (staff_id = auth.uid() AND state = 'published'
     AND EXISTS (SELECT 1 FROM public.profiles actor
       WHERE actor.id = auth.uid() AND actor.organization_slug = 'rdhotels'))
   OR public.work_schedule_can_manage(hotel_id)
 )
);
-- No authenticated table-write policies or table-write grants: writes require audited RPCs.

CREATE OR REPLACE FUNCTION public.work_schedule_staff_for_hotel(p_hotel_id text)
RETURNS TABLE(id uuid, full_name text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF NOT public.work_schedule_can_manage(p_hotel_id) THEN
   RAISE EXCEPTION 'Schedule management is not permitted for this venue' USING ERRCODE = '42501';
 END IF;
 RETURN QUERY SELECT p.id, p.full_name, p.role::text FROM public.profiles p
 JOIN public.hotel_configurations h ON h.hotel_id=p_hotel_id
 JOIN public.organizations org ON org.id=h.organization_id
 WHERE p.organization_slug = org.slug AND org.slug='rdhotels'
   AND (p.assigned_hotel IN (h.hotel_id,h.hotel_name) OR p.hotel_id=h.hotel_id)
 ORDER BY p.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.work_schedule_staff_for_hotel(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_schedule_staff_for_hotel(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.work_schedule_save_draft(
 p_hotel_id text, p_staff_id uuid, p_shift_date date, p_slot smallint,
 p_kind text, p_start_local time without time zone DEFAULT NULL,
 p_end_local time without time zone DEFAULT NULL, p_end_day_offset smallint DEFAULT 0,
 p_unpaid_break_minutes integer DEFAULT 0, p_note text DEFAULT '',
 p_entry_id uuid DEFAULT NULL, p_expected_version integer DEFAULT NULL,
 p_source text DEFAULT 'manual'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_entry public.work_schedule_entries%ROWTYPE; v_id uuid; v_previous jsonb;
BEGIN
 IF NOT public.work_schedule_can_manage(p_hotel_id) THEN
   RAISE EXCEPTION 'Schedule management is not permitted for this venue' USING ERRCODE = '42501';
 END IF;
 IF p_staff_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles staff
    JOIN public.hotel_configurations h ON h.hotel_id=p_hotel_id
    JOIN public.organizations org ON org.id=h.organization_id
    WHERE staff.id=p_staff_id AND staff.organization_slug=org.slug AND org.slug='rdhotels'
      AND (staff.assigned_hotel IN (h.hotel_id,h.hotel_name) OR staff.hotel_id=h.hotel_id)
 ) THEN
   RAISE EXCEPTION 'Employee must be explicitly assigned to this venue' USING ERRCODE='42501';
 END IF;
 IF p_shift_date IS NULL OR p_slot IS NULL OR p_slot NOT BETWEEN 1 AND 4
   OR p_kind IS NULL OR p_kind NOT IN ('work','off','leave','training','unavailable')
   OR p_source IS NULL OR p_source NOT IN ('manual','xlsx')
   OR length(COALESCE(p_note,''))>500 THEN
   RAISE EXCEPTION 'Invalid roster entry';
 END IF;
 IF p_kind='work' AND (p_start_local IS NULL OR p_end_local IS NULL
    OR p_end_day_offset NOT IN (0,1)
    OR (p_end_day_offset=0 AND p_end_local<=p_start_local)
    OR p_unpaid_break_minutes NOT BETWEEN 0 AND 240
    OR (extract(epoch FROM (p_end_local - p_start_local))/60 + p_end_day_offset*1440)
        <= p_unpaid_break_minutes) THEN
    RAISE EXCEPTION 'Invalid working shift time or break';
 END IF;
 IF p_kind<>'work' AND (p_start_local IS NOT NULL OR p_end_local IS NOT NULL
    OR p_end_day_offset<>0 OR p_unpaid_break_minutes<>0) THEN
    RAISE EXCEPTION 'Non-working days cannot contain shift hours';
 END IF;
 IF p_entry_id IS NOT NULL THEN
   SELECT * INTO v_entry FROM public.work_schedule_entries WHERE id=p_entry_id FOR UPDATE;
   IF NOT FOUND OR v_entry.hotel_id<>p_hotel_id OR v_entry.staff_id<>p_staff_id
       OR v_entry.organization_slug<>'rdhotels' THEN
      RAISE EXCEPTION 'Roster entry does not belong to the authorized employee/venue' USING ERRCODE='42501';
   END IF;
   IF v_entry.state<>'draft' OR p_expected_version IS NULL
        OR v_entry.version<>p_expected_version THEN
     RAISE EXCEPTION 'Roster changed or was published: reload before editing' USING ERRCODE='40001';
   END IF;
   v_previous := to_jsonb(v_entry);
   UPDATE public.work_schedule_entries SET shift_date=p_shift_date, slot=p_slot,
     kind=p_kind, start_local=p_start_local, end_local=p_end_local,
     end_day_offset=p_end_day_offset, unpaid_break_minutes=p_unpaid_break_minutes,
     note=COALESCE(p_note,''), source=p_source, version=version+1,
     updated_by=auth.uid(), updated_at=now() WHERE id=p_entry_id
     RETURNING * INTO v_entry;
   v_id := v_entry.id;
 ELSE
   INSERT INTO public.work_schedule_entries(hotel_id,staff_id,shift_date,slot,kind,
     start_local,end_local,end_day_offset,unpaid_break_minutes,note,source,created_by,updated_by)
   VALUES(p_hotel_id,p_staff_id,p_shift_date,p_slot,p_kind,p_start_local,p_end_local,
     p_end_day_offset,p_unpaid_break_minutes,COALESCE(p_note,''),p_source,auth.uid(),auth.uid())
   RETURNING * INTO v_entry;
   v_id := v_entry.id;
 END IF;
 INSERT INTO public.work_schedule_events(entry_id,actor_id,event_kind,before_data,after_data)
 VALUES(v_id,auth.uid(),CASE WHEN p_entry_id IS NULL THEN 'create' ELSE 'edit' END,
   v_previous,to_jsonb(v_entry));
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.work_schedule_save_draft(text,uuid,date,smallint,text,time without time zone,time without time zone,smallint,integer,text,uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_schedule_save_draft(text,uuid,date,smallint,text,time without time zone,time without time zone,smallint,integer,text,uuid,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.work_schedule_publish_range(p_hotel_id text,p_from date,p_to date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_item public.work_schedule_entries%ROWTYPE; v_count integer := 0; v_new public.work_schedule_entries%ROWTYPE;
BEGIN
 IF NOT public.work_schedule_can_manage(p_hotel_id) THEN
   RAISE EXCEPTION 'Schedule publication is not permitted for this venue' USING ERRCODE='42501';
 END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to>p_from+31 THEN
   RAISE EXCEPTION 'Publish a valid interval no longer than 32 days';
 END IF;
 FOR v_item IN SELECT * FROM public.work_schedule_entries
   WHERE organization_slug='rdhotels' AND hotel_id=p_hotel_id
     AND shift_date BETWEEN p_from AND p_to AND state='draft'
   ORDER BY id FOR UPDATE LOOP
    UPDATE public.work_schedule_entries SET state='published',version=version+1,
       updated_by=auth.uid(),updated_at=now() WHERE id=v_item.id RETURNING * INTO v_new;
    INSERT INTO public.work_schedule_events(entry_id,actor_id,event_kind,before_data,after_data)
      VALUES(v_item.id,auth.uid(),'publish',to_jsonb(v_item),to_jsonb(v_new));
    v_count := v_count+1;
 END LOOP;
 RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.work_schedule_publish_range(text,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.work_schedule_publish_range(text,date,date) TO authenticated;

-- Future HR medical evidence must be in a separate private store and entitlement model.
-- This migration intentionally does NOT create health records, leave balances or payroll entries.
