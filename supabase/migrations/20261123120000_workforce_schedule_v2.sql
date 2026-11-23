-- Work schedule v2 (owner request, 23 Nov 2026)
--
-- 1. Housekeeping managers see the work schedule of every hotel (read-only
--    outside their own hotel). Supervisors and reception keep their own hotel.
-- 2. Changes to a published day stay private until they are published again:
--    the employee keeps seeing the last published version
--    (workforce_entries.published_version), never an empty day.
-- 3. When a published day really changes, the employee gets one clear notice
--    (before -> after, who, when, reason) that they acknowledge, and a push
--    notification. First publication of a month creates no notices.
-- 4. Optional visibility window: staff see only the next N days of their
--    published schedule (approved leave is always visible).
-- 5. Hotel-level managers can read the change history of their own hotel, so
--    "restore to a point in time" works for them too.
--
-- Additive only: no table or column is dropped, existing rows keep their
-- meaning, and every existing policy is re-created with the same rules plus
-- the additions above.

-- ---------------------------------------------------------------------------
-- 1. Who may read every hotel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workforce_can_view_all()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT p.is_super_admin IS TRUE
        OR p.role::text IN ('admin', 'top_management', 'top_management_manager', 'hr')
        OR (p.access_role = 'manager' AND public.effective_access_role(p.access_role, p.role::text) = 'manager')
        OR public.effective_access_role(p.access_role, p.role::text) = 'housekeeping_manager'
      FROM public.profiles p
     WHERE p.id = auth.uid() AND p.deleted_at IS NULL
  ), false)
$$;
REVOKE ALL ON FUNCTION public.workforce_can_view_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_can_view_all() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. New columns and tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.workforce_entries ADD COLUMN IF NOT EXISTS published_version jsonb;
COMMENT ON COLUMN public.workforce_entries.published_version IS
  'The version the employee still sees while a change to a published day waits to be published. NULL when nothing is pending.';

ALTER TABLE public.workforce_settings ADD COLUMN IF NOT EXISTS staff_visible_days integer
  CHECK (staff_visible_days IS NULL OR staff_visible_days BETWEEN 1 AND 92);
COMMENT ON COLUMN public.workforce_settings.staff_visible_days IS
  'Staff see their own published schedule only this many days ahead. NULL = everything that is published.';

-- A month counts as "published for this person" once a manager pressed Publish.
-- From then on an empty day means a day off, and later changes create notices.
CREATE TABLE IF NOT EXISTS public.workforce_published_months (
  staff_id uuid NOT NULL REFERENCES public.workforce_staff(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  organization_slug text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  PRIMARY KEY (staff_id, month)
);
ALTER TABLE public.workforce_published_months ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workforce_published_months FROM anon, authenticated;
GRANT SELECT, INSERT ON public.workforce_published_months TO authenticated;
GRANT ALL ON public.workforce_published_months TO service_role;

DROP POLICY IF EXISTS "workforce read published months" ON public.workforce_published_months;
CREATE POLICY "workforce read published months" ON public.workforce_published_months FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) IN ('org', 'property')
    OR (SELECT public.workforce_can_view_all())
    OR public.workforce_staff_is_mine(staff_id)
  )
);
DROP POLICY IF EXISTS "workforce mark published months" ON public.workforce_published_months;
CREATE POLICY "workforce mark published months" ON public.workforce_published_months FOR INSERT TO authenticated
WITH CHECK (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND public.workforce_staff_org(staff_id) = organization_slug
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
);

-- Months that already hold published days count as published.
INSERT INTO public.workforce_published_months (staff_id, month, organization_slug, published_at)
SELECT e.staff_id, date_trunc('month', e.work_date)::date, e.organization_slug,
       LEAST(COALESCE(min(e.published_at), now()), now() - interval '1 minute')
  FROM public.workforce_entries e
 WHERE e.status = 'published'
 GROUP BY e.staff_id, date_trunc('month', e.work_date)::date, e.organization_slug
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.workforce_change_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  staff_id uuid NOT NULL REFERENCES public.workforce_staff(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  -- NULL = day off (nothing planned on that day).
  before jsonb,
  after jsonb,
  -- Less than four days before the shift: Mt. 97. § (5) needs the employee's agreement.
  short_notice boolean NOT NULL DEFAULT false,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 300),
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  pushed_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS workforce_change_notices_open_idx
  ON public.workforce_change_notices (staff_id, work_date) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS workforce_change_notices_org_idx
  ON public.workforce_change_notices (organization_slug, work_date);

ALTER TABLE public.workforce_change_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workforce_change_notices FROM anon, authenticated;
GRANT SELECT ON public.workforce_change_notices TO authenticated;
GRANT ALL ON public.workforce_change_notices TO service_role;

DROP POLICY IF EXISTS "workforce read change notices" ON public.workforce_change_notices;
CREATE POLICY "workforce read change notices" ON public.workforce_change_notices FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR (SELECT public.workforce_can_view_all())
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
    OR (public.workforce_staff_is_mine(staff_id) AND public.workforce_self_view_allowed())
  )
);

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- What the employee is shown for one day.
CREATE OR REPLACE FUNCTION public.workforce_entry_snapshot(_row public.workforce_entries)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'kind', _row.kind, 'code', _row.code,
    'start_time', to_char(_row.start_time, 'HH24:MI'), 'end_time', to_char(_row.end_time, 'HH24:MI'),
    'day_fraction', _row.day_fraction, 'extra_minutes', _row.extra_minutes,
    'hotel_id', _row.hotel_id, 'note', _row.note, 'worked_minutes', _row.worked_minutes)
$$;

-- The part of a snapshot that makes two days "the same shift". A day off, a
-- fixed day off and an empty day are the same thing for the employee (NULL).
CREATE OR REPLACE FUNCTION public.workforce_shift_key(_snapshot jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE
    WHEN _snapshot IS NULL OR _snapshot->>'kind' IN ('day_off', 'fixed_day_off') THEN NULL
    ELSE jsonb_build_object(
      'kind', _snapshot->'kind', 'code', _snapshot->'code',
      'start_time', _snapshot->'start_time', 'end_time', _snapshot->'end_time',
      'day_fraction', (_snapshot->>'day_fraction')::numeric, 'extra_minutes', (_snapshot->>'extra_minutes')::integer,
      'hotel_id', _snapshot->'hotel_id')
  END
$$;

CREATE OR REPLACE FUNCTION public.workforce_staff_visible_days(_org text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT s.staff_visible_days FROM public.workforce_settings s WHERE s.organization_slug = _org $$;

-- May an employee see their own published day yet? Past days and approved
-- absences always; shifts only inside the visibility window when one is set.
CREATE OR REPLACE FUNCTION public.workforce_self_date_visible(_org text, _date date, _kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.workforce_staff_visible_days(_org) IS NULL
      OR _kind IN ('leave', 'half_leave', 'sick', 'unpaid_leave')
      OR _date <= (timezone('Europe/Budapest', now()))::date + public.workforce_staff_visible_days(_org)
$$;

REVOKE ALL ON FUNCTION public.workforce_entry_snapshot(public.workforce_entries) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_shift_key(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_staff_visible_days(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_self_date_visible(text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_entry_snapshot(public.workforce_entries) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workforce_shift_key(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workforce_staff_visible_days(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workforce_self_date_visible(text, date, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Entry trigger: keep the published version while a change is pending
-- ---------------------------------------------------------------------------
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

  -- The published version is managed here only; a client cannot set it.
  IF TG_OP = 'INSERT' THEN
    NEW.published_version := NULL;
  ELSIF NEW.status = 'draft' THEN
    NEW.published_version := CASE WHEN OLD.status = 'published'
      THEN public.workforce_entry_snapshot(OLD) ELSE OLD.published_version END;
    -- Changed back to exactly what the employee sees: nothing is pending.
    IF NEW.published_version IS NOT NULL
       AND public.workforce_shift_key(NEW.published_version) IS NOT DISTINCT FROM public.workforce_shift_key(public.workforce_entry_snapshot(NEW))
       AND (NEW.published_version->>'note') IS NOT DISTINCT FROM NEW.note THEN
      NEW.status := 'published';
      NEW.published_version := NULL;
    END IF;
  ELSE
    NEW.published_version := NULL;
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
REVOKE ALL ON FUNCTION public.workforce_entry_prepare() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Change notices
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workforce_entry_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today date := (timezone('Europe/Budapest', now()))::date;
  src public.workforce_entries := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  seen jsonb;      -- what the employee saw until now
  shown jsonb;     -- what they see from now on
  open_notice public.workforce_change_notices;
  month_known boolean;
BEGIN
  IF current_setting('workforce.importing', true) = 'on' OR src.work_date < today THEN RETURN NULL; END IF;
  -- Removing an employee removes their days: nobody is left to tell.
  IF NOT EXISTS (SELECT 1 FROM public.workforce_staff s WHERE s.id = src.staff_id) THEN RETURN NULL; END IF;

  month_known := EXISTS (
    SELECT 1 FROM public.workforce_published_months pm
     WHERE pm.staff_id = src.staff_id AND pm.month = date_trunc('month', src.work_date)::date
       AND pm.published_at < now());

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN seen := public.workforce_entry_snapshot(OLD);
    ELSIF OLD.published_version IS NOT NULL THEN seen := OLD.published_version;
    ELSE RETURN NULL; END IF;
    shown := NULL;
  ELSIF NEW.status = 'published' THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN seen := public.workforce_entry_snapshot(OLD);
    ELSIF TG_OP = 'UPDATE' AND OLD.published_version IS NOT NULL THEN seen := OLD.published_version;
    ELSIF month_known THEN seen := NULL;   -- the employee saw a day off here
    ELSE RETURN NULL;                      -- first publication of the month
    END IF;
    shown := public.workforce_entry_snapshot(NEW);
  ELSE
    RETURN NULL;                           -- drafts are private
  END IF;

  SELECT * INTO open_notice FROM public.workforce_change_notices n
   WHERE n.staff_id = src.staff_id AND n.work_date = src.work_date AND n.acknowledged_at IS NULL;

  IF open_notice.id IS NOT NULL THEN
    -- Several changes before the employee looked: keep what they originally saw.
    IF public.workforce_shift_key(open_notice.before) IS NOT DISTINCT FROM public.workforce_shift_key(shown) THEN
      DELETE FROM public.workforce_change_notices WHERE id = open_notice.id;
    ELSE
      UPDATE public.workforce_change_notices
         SET after = shown, changed_by = auth.uid(), changed_at = now(), pushed_at = NULL,
             short_notice = (src.work_date - today) < 4
       WHERE id = open_notice.id;
    END IF;
  ELSIF public.workforce_shift_key(seen) IS DISTINCT FROM public.workforce_shift_key(shown) THEN
    INSERT INTO public.workforce_change_notices (organization_slug, staff_id, work_date, before, after, short_notice, changed_by)
    VALUES (src.organization_slug, src.staff_id, src.work_date, seen, shown, (src.work_date - today) < 4, auth.uid());
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_entry_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS workforce_entries_notice ON public.workforce_entries;
CREATE TRIGGER workforce_entries_notice AFTER INSERT OR UPDATE OR DELETE ON public.workforce_entries
FOR EACH ROW EXECUTE FUNCTION public.workforce_entry_notice();

-- One push per employee for the changes that were not announced yet.
CREATE OR REPLACE FUNCTION public.workforce_push_change_notices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor record;
  target record;
  sent integer := 0;
  title text;
  body text;
BEGIN
  SELECT * INTO actor FROM public.workforce_access() LIMIT 1;
  IF actor IS NULL OR actor.access_level NOT IN ('org', 'property') THEN RETURN 0; END IF;

  FOR target IN
    SELECT s.profile_id, p.app_language, array_agg(n.id) AS ids
      FROM public.workforce_change_notices n
      JOIN public.workforce_staff s ON s.id = n.staff_id
      JOIN public.profiles p ON p.id = s.profile_id AND p.deleted_at IS NULL
     WHERE n.organization_slug = actor.organization_slug
       AND n.acknowledged_at IS NULL AND n.pushed_at IS NULL
       AND n.work_date >= (timezone('Europe/Budapest', now()))::date
       -- Housekeepers and maintenance are told only once their schedule is live.
       AND (public.effective_access_role(p.access_role, p.role::text) NOT IN ('housekeeping', 'maintenance')
            OR public.workforce_staff_schedule_live(n.organization_slug))
     GROUP BY s.profile_id, p.app_language
  LOOP
    SELECT t.title, t.body INTO title, body FROM (VALUES
      ('en', 'Your work schedule changed', 'Open HotelCare to see what changed and confirm.'),
      ('hu', 'Változott a beosztásod', 'Nyisd meg a HotelCare-t, nézd meg a változást, és erősítsd meg.'),
      ('es', 'Tu horario ha cambiado', 'Abre HotelCare para ver el cambio y confirmarlo.'),
      ('vi', 'Lịch làm việc của bạn đã thay đổi', 'Mở HotelCare để xem thay đổi và xác nhận.'),
      ('mn', 'Таны ажлын хуваарь өөрчлөгдлөө', 'HotelCare-г нээж өөрчлөлтийг харж, баталгаажуулна уу.'),
      ('az', 'İş qrafikiniz dəyişdi', 'Dəyişikliyi görmək və təsdiqləmək üçün HotelCare-i açın.'),
      ('tl', 'Nagbago ang iskedyul mo', 'Buksan ang HotelCare para makita ang pagbabago at kumpirmahin.'),
      ('uk', 'Ваш графік змінено', 'Відкрийте HotelCare, щоб переглянути зміну та підтвердити.'),
      ('ru', 'Ваш график изменён', 'Откройте HotelCare, чтобы посмотреть изменение и подтвердить.')
    ) AS t(lang, title, body)
    ORDER BY (t.lang = COALESCE(target.app_language, 'en')) DESC, (t.lang = 'en') DESC LIMIT 1;

    PERFORM public.hotelcare_dispatch_push(
      ARRAY[target.profile_id], title, body, '/' || actor.organization_slug || '?schedule=changes',
      'workforce-schedule-change', 'workforce_schedule_change',
      jsonb_build_object('notices', cardinality(target.ids)));
    UPDATE public.workforce_change_notices SET pushed_at = now() WHERE id = ANY(target.ids);
    sent := sent + 1;
  END LOOP;
  RETURN sent;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_push_change_notices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_push_change_notices() TO authenticated;

-- The employee confirms they have seen the change.
CREATE OR REPLACE FUNCTION public.workforce_acknowledge_changes(_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.workforce_change_notices n
     SET acknowledged_at = now()
   WHERE n.id = ANY(_ids) AND n.acknowledged_at IS NULL
     AND public.workforce_staff_is_mine(n.staff_id);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_acknowledge_changes(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_acknowledge_changes(uuid[]) TO authenticated;

-- The planner adds why the day changed ("Covering a sick colleague").
CREATE OR REPLACE FUNCTION public.workforce_set_change_reason(_ids uuid[], _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor record;
  changed integer;
BEGIN
  SELECT * INTO actor FROM public.workforce_access() LIMIT 1;
  IF actor IS NULL OR actor.access_level NOT IN ('org', 'property') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workforce_change_notices n
     SET reason = NULLIF(left(btrim(COALESCE(_reason, '')), 300), '')
   WHERE n.id = ANY(_ids) AND n.acknowledged_at IS NULL
     AND n.organization_slug = actor.organization_slug
     AND (actor.access_level = 'org' OR public.workforce_staff_hotel(n.staff_id) = actor.hotel_id);
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_set_change_reason(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_set_change_reason(uuid[], text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Publish: mark the months, then tell the people whose days changed
-- ---------------------------------------------------------------------------
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

  INSERT INTO public.workforce_published_months (staff_id, month, organization_slug, published_by)
  SELECT DISTINCT e.staff_id, date_trunc('month', e.work_date)::date, e.organization_slug, auth.uid()
    FROM public.workforce_entries e
   WHERE e.status = 'published' AND e.published_at = now() AND e.work_date BETWEEN _from AND _to
     AND (_staff_ids IS NULL OR e.staff_id = ANY(_staff_ids))
     AND NOT EXISTS (SELECT 1 FROM public.workforce_published_months pm
                      WHERE pm.staff_id = e.staff_id AND pm.month = date_trunc('month', e.work_date)::date)
  ON CONFLICT DO NOTHING;

  PERFORM public.workforce_push_change_notices();
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_publish(date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_publish(date, date, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. The employee's own schedule, exactly as published
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workforce_my_schedule(_from date, _to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  me public.workforce_staff;
  today date := (timezone('Europe/Budapest', now()))::date;
  window_days integer;
  result jsonb;
BEGIN
  IF _to < _from OR _to - _from > 120 THEN RAISE EXCEPTION 'Ask for at most four months'; END IF;
  SELECT * INTO me FROM public.workforce_staff s WHERE s.profile_id = auth.uid() LIMIT 1;
  IF me.id IS NULL OR NOT public.workforce_self_view_allowed() THEN
    RETURN jsonb_build_object('linked', me.id IS NOT NULL, 'allowed', false, 'days', '[]'::jsonb,
                              'published_months', '[]'::jsonb, 'visible_until', NULL, 'changes', '[]'::jsonb);
  END IF;
  window_days := public.workforce_staff_visible_days(me.organization_slug);

  SELECT jsonb_build_object(
    'linked', true, 'allowed', true,
    'visible_until', CASE WHEN window_days IS NULL THEN NULL ELSE today + window_days END,
    'days', COALESCE((
      SELECT jsonb_agg(d.snapshot || jsonb_build_object('work_date', d.work_date, 'staff_id', me.id, 'status', 'published') ORDER BY d.work_date)
        FROM (
          SELECT e.work_date,
                 CASE WHEN e.status = 'published' THEN public.workforce_entry_snapshot(e) ELSE e.published_version END AS snapshot
            FROM public.workforce_entries e
           WHERE e.staff_id = me.id AND e.work_date BETWEEN _from AND _to
             AND (e.status = 'published' OR e.published_version IS NOT NULL)
        ) d
       WHERE public.workforce_self_date_visible(me.organization_slug, d.work_date, d.snapshot->>'kind')
    ), '[]'::jsonb),
    'published_months', COALESCE((
      SELECT jsonb_agg(to_char(pm.month, 'YYYY-MM') ORDER BY pm.month)
        FROM public.workforce_published_months pm
       WHERE pm.staff_id = me.id AND pm.month BETWEEN date_trunc('month', _from)::date AND _to
    ), '[]'::jsonb),
    'changes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', n.id, 'work_date', n.work_date, 'before', n.before, 'after', n.after,
               'short_notice', n.short_notice, 'reason', n.reason, 'changed_at', n.changed_at,
               'changed_by_name', (SELECT COALESCE(NULLIF(p.nickname, ''), p.full_name) FROM public.profiles p WHERE p.id = n.changed_by)
             ) ORDER BY n.work_date)
        FROM public.workforce_change_notices n
       WHERE n.staff_id = me.id AND n.acknowledged_at IS NULL AND n.work_date >= today
         AND public.workforce_self_date_visible(me.organization_slug, n.work_date,
               COALESCE(n.after->>'kind', n.before->>'kind'))
    ), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.workforce_my_schedule(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_my_schedule(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Visibility window setting (HR, top management, administrators)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_workforce_staff_visible_days(_days integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE actor record;
BEGIN
  SELECT p.organization_slug, p.is_super_admin, p.role::text AS role INTO actor
    FROM public.profiles p WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
  IF actor IS NULL OR actor.organization_slug IS NULL
     OR NOT (actor.is_super_admin IS TRUE OR actor.role IN ('admin', 'top_management', 'top_management_manager', 'hr')) THEN
    RAISE EXCEPTION 'Only HR, top management or an administrator can change what staff see' USING ERRCODE = '42501';
  END IF;
  IF _days IS NOT NULL AND _days NOT BETWEEN 1 AND 92 THEN RAISE EXCEPTION 'Choose between 1 and 92 days'; END IF;
  INSERT INTO public.workforce_settings AS s (organization_slug, staff_visible_days, updated_at)
  VALUES (actor.organization_slug, _days, now())
  ON CONFLICT (organization_slug) DO UPDATE SET staff_visible_days = EXCLUDED.staff_visible_days, updated_at = now();
  RETURN _days;
END;
$$;
REVOKE ALL ON FUNCTION public.set_workforce_staff_visible_days(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workforce_staff_visible_days(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Read policies: housekeeping managers read every hotel; the visibility
--    window applies to an employee's own days; history readable per hotel
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "workforce read staff" ON public.workforce_staff;
CREATE POLICY "workforce read staff" ON public.workforce_staff
FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
  AND (
    (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'org'
    OR (SELECT public.workforce_can_view_all())
    OR (profile_id = (SELECT auth.uid()) AND public.workforce_self_view_allowed())
    OR (
      (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'property'
      AND (
        hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
        OR public.workforce_staff_works_at(id, (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)))
      )
    )
  )
);

DROP POLICY IF EXISTS "workforce read entries" ON public.workforce_entries;
CREATE POLICY "workforce read entries" ON public.workforce_entries
FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
  AND (
    (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'org'
    OR (SELECT public.workforce_can_view_all())
    OR (
      (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'property'
      AND (
        hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
        OR public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
      )
    )
    OR (status = 'published' AND public.workforce_staff_is_mine(staff_id) AND public.workforce_self_view_allowed()
        AND public.workforce_self_date_visible(organization_slug, work_date, kind))
  )
);

DROP POLICY IF EXISTS "workforce read notes all hotels" ON public.workforce_staff_notes;
CREATE POLICY "workforce read notes all hotels" ON public.workforce_staff_notes
FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (SELECT public.workforce_can_view_all())
);

DROP POLICY IF EXISTS "workforce read audit" ON public.workforce_audit_log;
CREATE POLICY "workforce read audit" ON public.workforce_audit_log FOR SELECT TO authenticated
USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND (
    (SELECT a.access_level FROM public.workforce_access() a) = 'org'
    OR (SELECT public.workforce_can_view_all())
    OR ((SELECT a.access_level FROM public.workforce_access() a) = 'property'
        AND staff_id IS NOT NULL
        AND public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a))
  )
);
CREATE INDEX IF NOT EXISTS workforce_audit_log_date_idx
  ON public.workforce_audit_log (organization_slug, work_date, created_at) WHERE table_name = 'workforce_entries';
