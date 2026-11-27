-- REVIEW / scratch CI only. Generate the versioned migration with Supabase CLI
-- after this SQL has passed its fixture and production compatibility checks.
-- Do not apply this file directly to production.
CREATE SCHEMA IF NOT EXISTS attendance_internal;
REVOKE ALL ON SCHEMA attendance_internal FROM PUBLIC, anon, authenticated;

-- An immutable, server-derived property snapshot. Legacy/manual rows stay NULL.
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS work_hotel_id text;
CREATE OR REPLACE FUNCTION attendance_internal.capture_rd_work_hotel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected text; requested text;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.work_hotel_id IS DISTINCT FROM OLD.work_hotel_id THEN
     RAISE EXCEPTION 'Attendance property snapshot cannot be edited' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 requested:=NEW.work_hotel_id;
 NEW.work_hotel_id:=NULL;
 IF NEW.organization_slug IS DISTINCT FROM 'rdhotels' OR auth.uid() IS DISTINCT FROM NEW.user_id
    OR NEW.check_in_time IS NULL OR abs(extract(epoch from (now()-NEW.check_in_time)))>300
    OR NEW.check_out_time IS NOT NULL THEN RETURN NEW; END IF;
 -- Operational staff's work hotel is server-selected. For other employees
 -- a client-selected property is allowed only if both organization and property
 -- access checks pass. An unavailable property must never block clock-in.
 SELECT h.hotel_id INTO selected
 FROM public.profiles p
 JOIN public.organizations o ON o.slug=p.organization_slug AND o.is_active IS TRUE
 JOIN public.hotel_configurations h ON h.organization_id=o.id AND h.is_active IS TRUE
 WHERE p.id=NEW.user_id AND p.deleted_at IS NULL AND p.organization_slug=NEW.organization_slug
 AND lower(h.hotel_id)=lower(public.workforce_hotel_key(p.organization_slug,
   CASE WHEN p.role::text IN ('housekeeping','maintenance','maintenance_manager')
        THEN p.assigned_hotel ELSE coalesce(nullif(requested,''),p.assigned_hotel) END))
 AND public.user_can_access_hotel(p.id,h.hotel_id)
 ORDER BY h.hotel_id LIMIT 1;
 NEW.work_hotel_id:=selected;
 NEW.work_date:=(NEW.check_in_time AT TIME ZONE 'Europe/Budapest')::date;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION attendance_internal.capture_rd_work_hotel() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER rd_attendance_capture_property BEFORE INSERT OR UPDATE OF work_hotel_id
ON public.staff_attendance FOR EACH ROW EXECUTE FUNCTION attendance_internal.capture_rd_work_hotel();

CREATE TABLE public.rd_attendance_auto_checkout_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 attendance_id uuid NOT NULL, organization_slug text NOT NULL CHECK(organization_slug='rdhotels'),
 employee_id uuid NOT NULL, cutoff_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 source text NOT NULL CHECK(source IN ('scheduler','manual','forgotten')),
 actor_id uuid, previous_status text NOT NULL, break_minutes integer NOT NULL CHECK(break_minutes>=0),
 net_hours numeric NOT NULL CHECK(net_hours>=0)
);
ALTER TABLE public.rd_attendance_auto_checkout_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rd_attendance_auto_checkout_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.rd_attendance_auto_checkout_events TO authenticated;
CREATE POLICY rd_auto_checkout_audit_read ON public.rd_attendance_auto_checkout_events FOR SELECT TO authenticated
 USING (organization_slug=public.get_user_organization_slug(auth.uid())
   AND (public.is_hr_manager(auth.uid()) OR public.is_top_management(auth.uid())));

-- Single authoritative time policy. Published work snapshots (including
-- positive extra_minutes) override the default if they end later.
-- No speculative default for unscheduled reception, night/late-start or unknown
-- roles. Unscheduled day-role staff qualify only for a morning clock-in.
CREATE OR REPLACE FUNCTION attendance_internal.rd_cutoff(
 _employee uuid,_work_date date,_check_in timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE p public.profiles%ROWTYPE; snapshot jsonb; published_count integer;
  start_at time; end_at time; end_ts timestamptz; default_ts timestamptz; extra integer; role_name text;
BEGIN
 IF _work_date IS NULL OR _check_in IS NULL
 OR (_check_in AT TIME ZONE 'Europe/Budapest')::date<>_work_date THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=_employee AND organization_slug='rdhotels' AND deleted_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 default_ts:=(_work_date+time '17:00') AT TIME ZONE 'Europe/Budapest';
 SELECT count(*) INTO published_count FROM public.workforce_staff s JOIN public.workforce_entries e
 ON e.staff_id=s.id AND e.organization_slug=s.organization_slug
 WHERE s.profile_id=_employee AND s.organization_slug='rdhotels' AND e.work_date=_work_date
 AND (e.status='published' OR e.published_version IS NOT NULL);
 IF published_count>1 THEN RETURN NULL; END IF;
 IF published_count=1 THEN
   SELECT CASE WHEN e.status='published' THEN to_jsonb(e) ELSE e.published_version END INTO snapshot
   FROM public.workforce_staff s JOIN public.workforce_entries e ON e.staff_id=s.id AND e.organization_slug=s.organization_slug
   WHERE s.profile_id=_employee AND s.organization_slug='rdhotels' AND e.work_date=_work_date
   AND (e.status='published' OR e.published_version IS NOT NULL);
   IF coalesce(snapshot->>'kind','') NOT IN ('work','night','training','home_office','extra_day') THEN RETURN NULL; END IF;
   BEGIN
     start_at:=(snapshot->>'start_time')::time;
     end_at:=(snapshot->>'end_time')::time;
     extra:=greatest(0,coalesce((snapshot->>'extra_minutes')::integer,0));
   EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
     RETURN NULL;
   END;
   IF start_at IS NULL OR end_at IS NULL OR extra>720 THEN RETURN NULL; END IF;
   end_ts:=(_work_date+end_at+CASE WHEN end_at<=start_at THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE 'Europe/Budapest';
   end_ts:=end_ts+make_interval(mins=>extra);
   IF end_ts<=_check_in THEN RETURN NULL; END IF;
   RETURN greatest(default_ts,end_ts);
 END IF;
 role_name:=public.effective_access_role(p.access_role,p.role::text);
 IF role_name NOT IN ('housekeeping','maintenance','housekeeping_manager','housekeeping_supervisor','breakfast')
 OR (_check_in AT TIME ZONE 'Europe/Budapest')::time>=time '12:00' THEN RETURN NULL; END IF;
 RETURN default_ts;
END $$;
REVOKE ALL ON FUNCTION attendance_internal.rd_cutoff(uuid,date,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the automatic/forgotten status instead of overwriting it as manual.
-- Other organizations retain the current trigger behavior.
CREATE OR REPLACE FUNCTION public.calculate_work_hours()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.check_out_time IS NOT NULL AND OLD.check_out_time IS NULL THEN
   IF NEW.organization_slug='rdhotels' THEN
     NEW.total_hours:=greatest(0,round((extract(epoch from (NEW.check_out_time-NEW.check_in_time))/3600.0)-coalesce(NEW.break_duration,0)/60.0,2));
     IF coalesce(NEW.status,'') NOT IN ('auto_signout','forgot_signout') OR current_user NOT IN ('postgres','service_role') THEN
       NEW.status:='checked_out';
     END IF;
   ELSE
     NEW.total_hours:=extract(epoch from (NEW.check_out_time-NEW.check_in_time))/3600.0-(NEW.break_duration/60.0);
     NEW.status:='checked_out';
   END IF;
 END IF;
 NEW.updated_at:=now();
 RETURN NEW;
END $$;

-- Internal locked closure. Never overwrites an existing actual checkout. Only
-- closes an eligible shift at or after its cutoff, on the cutoff's local day.
CREATE OR REPLACE FUNCTION attendance_internal.rd_close_due(_source text,_actor uuid DEFAULT NULL,_target uuid DEFAULT NULL,_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.staff_attendance%ROWTYPE; cutoff timestamptz; break_mins integer; elapsed_mins integer; n integer:=0;
BEGIN
 IF _source NOT IN ('scheduler','manual','forgotten') THEN RAISE EXCEPTION 'Invalid source'; END IF;
 FOR a IN SELECT sa.* FROM public.staff_attendance sa
   WHERE sa.organization_slug='rdhotels' AND sa.work_date BETWEEN (_at AT TIME ZONE 'Europe/Budapest')::date-1 AND (_at AT TIME ZONE 'Europe/Budapest')::date
   AND sa.check_out_time IS NULL AND sa.status IN ('checked_in','on_break')
   AND (_target IS NULL OR sa.id=_target)
   AND (_source<>'forgotten' OR sa.user_id=_actor)
   AND NOT EXISTS(SELECT 1 FROM public.early_signout_requests er WHERE er.attendance_id=sa.id AND er.organization_slug=sa.organization_slug AND er.status='pending')
   FOR UPDATE OF sa SKIP LOCKED
 LOOP
   cutoff:=attendance_internal.rd_cutoff(a.user_id,a.work_date,a.check_in_time);
   IF cutoff IS NULL OR cutoff<=a.check_in_time OR cutoff>_at
   OR (cutoff AT TIME ZONE 'Europe/Budapest')::date<>(_at AT TIME ZONE 'Europe/Budapest')::date
   OR (_source<>'forgotten' AND _at>cutoff+interval '30 minutes') THEN CONTINUE; END IF;
   elapsed_mins:=floor(extract(epoch from (cutoff-a.check_in_time))/60)::integer;
   break_mins:=greatest(0,coalesce(a.break_duration,0),coalesce(a.break_duration_minutes,0));
   IF a.status='on_break' THEN
     IF a.break_started_at IS NULL OR a.break_started_at<a.check_in_time OR a.break_started_at>cutoff
     OR (a.break_ended_at IS NOT NULL AND a.break_ended_at>=a.break_started_at) THEN CONTINUE; END IF;
     break_mins:=break_mins+floor(extract(epoch from (cutoff-a.break_started_at))/60)::integer;
   END IF;
   IF break_mins>elapsed_mins THEN CONTINUE; END IF;
   UPDATE public.staff_attendance SET check_out_time=cutoff,
      status=CASE WHEN _source='forgotten' THEN 'forgot_signout' ELSE 'auto_signout' END,
      break_duration=break_mins,break_duration_minutes=break_mins,
      break_ended_at=CASE WHEN a.status='on_break' THEN cutoff ELSE a.break_ended_at END,
      total_hours=greatest(0,round(extract(epoch from (cutoff-a.check_in_time))/3600.0-break_mins/60.0,2))
   WHERE id=a.id AND organization_slug='rdhotels' AND check_out_time IS NULL;
   IF FOUND THEN
     INSERT INTO public.rd_attendance_auto_checkout_events(attendance_id,organization_slug,employee_id,cutoff_at,source,actor_id,previous_status,break_minutes,net_hours)
     VALUES(a.id,'rdhotels',a.user_id,cutoff,_source,_actor,a.status,break_mins,greatest(0,round(extract(epoch from (cutoff-a.check_in_time))/3600.0-break_mins/60.0,2)));
     n:=n+1;
   END IF;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION attendance_internal.rd_close_due(text,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.run_rd_attendance_auto_signout()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT attendance_internal.rd_close_due('scheduler',NULL,NULL);
$$;
REVOKE ALL ON FUNCTION public.run_rd_attendance_auto_signout() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.run_rd_attendance_auto_signout() TO service_role;

CREATE OR REPLACE FUNCTION public.rd_attendance_manual_auto_signout()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.get_user_organization_slug(auth.uid()) IS DISTINCT FROM 'rdhotels'
 OR NOT public.is_hr_manager(auth.uid()) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN attendance_internal.rd_close_due('manual',auth.uid(),NULL);
END $$;
REVOKE ALL ON FUNCTION public.rd_attendance_manual_auto_signout() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rd_attendance_manual_auto_signout() TO authenticated;

CREATE OR REPLACE FUNCTION public.rd_attendance_forgot_checkout(_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.get_user_organization_slug(auth.uid()) IS DISTINCT FROM 'rdhotels' OR _id IS NULL
 THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN attendance_internal.rd_close_due('forgotten',auth.uid(),_id);
END $$;
REVOKE ALL ON FUNCTION public.rd_attendance_forgot_checkout(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rd_attendance_forgot_checkout(uuid) TO authenticated;

-- Production rollout must install the new one-minute cron job and exclude
-- RD Hotels from the legacy 23:50 UTC job atomically. Keep the legacy SQL
-- behavior for other organizations unchanged. See rollout checklist.
