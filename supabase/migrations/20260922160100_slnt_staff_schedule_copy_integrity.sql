-- Keep SLNT copies all-or-nothing and prevent a published shift with no venue.
-- Constraint triggers run at COMMIT, allowing atomic RPCs to replace links safely.
CREATE OR REPLACE FUNCTION public.slnt_assert_published_shift_venues()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE _id uuid;
BEGIN
  IF TG_TABLE_NAME = 'staff_schedules' THEN
    _id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    _id := OLD.schedule_id;
  ELSE
    _id := NEW.schedule_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_schedules s WHERE s.id = _id
      AND s.organization_slug = 'slnt' AND s.status = 'published'
      AND NOT EXISTS (SELECT 1 FROM public.staff_schedule_venues link WHERE link.schedule_id=s.id)
  ) THEN RAISE EXCEPTION 'Published SLNT shifts require a valid venue' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS slnt_published_shift_venues_guard ON public.staff_schedules;
CREATE CONSTRAINT TRIGGER slnt_published_shift_venues_guard
AFTER INSERT OR UPDATE ON public.staff_schedules
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.slnt_assert_published_shift_venues();
DROP TRIGGER IF EXISTS slnt_published_shift_link_guard ON public.staff_schedule_venues;
CREATE CONSTRAINT TRIGGER slnt_published_shift_link_guard
AFTER INSERT OR UPDATE OR DELETE ON public.staff_schedule_venues
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.slnt_assert_published_shift_venues();

CREATE OR REPLACE FUNCTION public.slnt_copy_staff_week(_hotel text, _from date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  row_source record;
  new_id uuid;
  links uuid[];
  copied integer := 0;
  skipped integer := 0;
BEGIN
  IF auth.uid() IS NULL OR _hotel IS NULL OR _from IS NULL
    OR extract(isodow from _from) <> 1
    OR NOT public.can_manage_slnt_schedule(_hotel) THEN
    RAISE EXCEPTION 'Not authorized to copy this week' USING ERRCODE='42501';
  END IF;
  FOR row_source IN
    SELECT s.* FROM public.staff_schedules s
    WHERE s.organization_slug='slnt' AND s.hotel_id=_hotel
      AND s.work_date BETWEEN _from - 7 AND _from - 1
    ORDER BY s.work_date,s.user_id
  LOOP
    IF NOT public.slnt_schedule_row_allowed('slnt',_hotel,row_source.user_id,row_source.id) THEN
      skipped := skipped+1; CONTINUE;
    END IF;
    SELECT coalesce(array_agg(link.venue_id), ARRAY[]::uuid[]) INTO links
      FROM public.staff_schedule_venues link WHERE link.schedule_id=row_source.id;
    IF (row_source.status <> 'off' AND cardinality(links)=0)
      OR EXISTS (SELECT 1 FROM unnest(links) AS candidate(venue_id)
        WHERE NOT public.slnt_schedule_venue_allowed(row_source.id,candidate.venue_id))
    THEN skipped := skipped+1; CONTINUE; END IF;
    new_id := NULL;
    INSERT INTO public.staff_schedules
      (organization_slug,hotel_id,user_id,work_date,shift_start,shift_end,status,notes,created_by)
    VALUES ('slnt',_hotel,row_source.user_id,row_source.work_date+7,
      row_source.shift_start,row_source.shift_end,
      CASE WHEN row_source.status='off' THEN 'off' ELSE 'draft' END,
      row_source.notes,auth.uid())
    ON CONFLICT (organization_slug,hotel_id,user_id,work_date) DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NULL THEN skipped := skipped+1; CONTINUE; END IF;
    INSERT INTO public.staff_schedule_venues(schedule_id,venue_id)
      SELECT new_id, candidate.venue_id FROM unnest(links) AS candidate(venue_id);
    copied := copied+1;
  END LOOP;
  RETURN jsonb_build_object('copied',copied,'skipped',skipped);
END;
$fn$;
REVOKE ALL ON FUNCTION public.slnt_copy_staff_week(text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.slnt_copy_staff_week(text,date) TO authenticated;
-- TRUNCATE bypasses RLS; it must not be executable by app users.
REVOKE TRUNCATE ON public.staff_schedules,public.staff_schedule_venues FROM anon,authenticated;
