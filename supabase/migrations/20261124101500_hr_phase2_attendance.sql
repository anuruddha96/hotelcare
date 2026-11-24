-- HR attendance: preserve raw records and published schedule snapshots.
ALTER TABLE public.workforce_settings ADD COLUMN IF NOT EXISTS punctuality_tolerance_minutes integer NOT NULL DEFAULT 5 CHECK (punctuality_tolerance_minutes BETWEEN 0 AND 120);
CREATE TABLE public.attendance_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL, attendance_id uuid NOT NULL,
 actor_id uuid NOT NULL, employee_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('correct','delete','manual')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), before_values jsonb, after_values jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.attendance_corrections TO authenticated;
CREATE POLICY attendance_audit_read ON public.attendance_corrections FOR SELECT TO authenticated
 USING (organization_slug = public.get_user_organization_slug(auth.uid()) AND (public.is_hr_manager(auth.uid()) OR public.is_top_management(auth.uid())));
CREATE OR REPLACE FUNCTION public.attendance_audit_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Attendance audit is immutable' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER attendance_audit_immutable BEFORE UPDATE OR DELETE ON public.attendance_corrections FOR EACH ROW EXECUTE FUNCTION public.attendance_audit_immutable();
CREATE POLICY hr_attendance_insert_scope ON public.staff_attendance AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (public.current_access_role() IS DISTINCT FROM 'hr' OR (user_id=auth.uid() AND organization_slug=public.get_user_organization_slug(auth.uid())));
CREATE POLICY hr_attendance_update_scope ON public.staff_attendance AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (public.current_access_role() IS DISTINCT FROM 'hr' OR (user_id=auth.uid() AND organization_slug=public.get_user_organization_slug(auth.uid())))
 WITH CHECK (public.current_access_role() IS DISTINCT FROM 'hr' OR (user_id=auth.uid() AND organization_slug=public.get_user_organization_slug(auth.uid())));
CREATE POLICY hr_attendance_delete_scope ON public.staff_attendance AS RESTRICTIVE FOR DELETE TO authenticated
 USING (public.current_access_role() IS DISTINCT FROM 'hr');
-- Internal helpers are not callable through the API.
CREATE FUNCTION public.hr_attendance_actor_org(_employee uuid, _reason text) RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor_org text;
BEGIN
 SELECT p.organization_slug INTO actor_org FROM public.profiles p WHERE p.id=auth.uid() AND p.deleted_at IS NULL;
 IF actor_org IS NULL OR NOT (public.is_hr_manager(auth.uid()) OR public.is_top_management(auth.uid()))
 OR _employee=auth.uid() OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=_employee AND p.organization_slug=actor_org)
 THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 IF _reason IS NULL OR length(btrim(_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
 RETURN actor_org;
END $$;
REVOKE ALL ON FUNCTION public.hr_attendance_actor_org(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.hr_attendance_hours(_date date,_in timestamptz,_out timestamptz,_break integer,_status text) RETURNS numeric
 LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF _date IS NULL OR _date > (now() AT TIME ZONE 'Europe/Budapest')::date OR _in IS NULL OR (_in AT TIME ZONE 'Europe/Budapest')::date <> _date OR _in > now()
 OR _break IS NULL OR _break<0 OR _status IS NULL OR _status NOT IN ('checked_in','on_break','checked_out')
 OR (_out IS NULL AND (_status='checked_out' OR _break>extract(epoch from now()-_in)/60))
 OR (_out IS NOT NULL AND (_status<>'checked_out' OR _out<_in OR _out>now() OR _out-_in>interval '36 hours' OR _break>extract(epoch from _out-_in)/60))
 THEN RAISE EXCEPTION 'Invalid attendance times' USING ERRCODE='22023'; END IF;
 RETURN CASE WHEN _out IS NULL THEN NULL ELSE round((extract(epoch from _out-_in)/3600-_break::numeric/60),4) END;
END $$;
REVOKE ALL ON FUNCTION public.hr_attendance_hours(date,timestamptz,timestamptz,integer,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.attendance_correct(_id uuid,_check_in timestamptz,_check_out timestamptz,_break_minutes integer,_status text,_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row public.staff_attendance%ROWTYPE; new_row public.staff_attendance%ROWTYPE; org text; hours numeric;
BEGIN
 SELECT * INTO old_row FROM public.staff_attendance WHERE id=_id AND organization_slug=public.get_user_organization_slug(auth.uid()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 org:=public.hr_attendance_actor_org(old_row.user_id,_reason);
 hours:=public.hr_attendance_hours(old_row.work_date,_check_in,_check_out,_break_minutes,_status);
 UPDATE public.staff_attendance SET check_in_time=_check_in,check_out_time=_check_out,break_duration=_break_minutes,
 break_duration_minutes=_break_minutes,total_hours=hours,status=_status,updated_at=now()
 WHERE id=_id AND organization_slug=org RETURNING * INTO new_row;
 INSERT INTO public.attendance_corrections(organization_slug,attendance_id,actor_id,employee_id,action,reason,before_values,after_values)
 VALUES(org,_id,auth.uid(),old_row.user_id,'correct',btrim(_reason),to_jsonb(old_row),to_jsonb(new_row));
END $$;
CREATE FUNCTION public.attendance_delete(_id uuid,_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_row public.staff_attendance%ROWTYPE; org text;
BEGIN
 SELECT * INTO old_row FROM public.staff_attendance WHERE id=_id AND organization_slug=public.get_user_organization_slug(auth.uid()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 org:=public.hr_attendance_actor_org(old_row.user_id,_reason);
 DELETE FROM public.staff_attendance WHERE id=_id AND organization_slug=org;
 INSERT INTO public.attendance_corrections(organization_slug,attendance_id,actor_id,employee_id,action,reason,before_values)
 VALUES(org,_id,auth.uid(),old_row.user_id,'delete',btrim(_reason),to_jsonb(old_row));
END $$;
CREATE FUNCTION public.attendance_manual_add(_employee uuid,_date date,_check_in timestamptz,_check_out timestamptz,_break_minutes integer,_note text,_reason text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE org text; new_row public.staff_attendance%ROWTYPE; hours numeric;
BEGIN
 org:=public.hr_attendance_actor_org(_employee,_reason);
 hours:=public.hr_attendance_hours(_date,_check_in,_check_out,_break_minutes,'checked_out');
 PERFORM pg_advisory_xact_lock(hashtextextended(_employee::text||_date::text,0));
 IF EXISTS(SELECT 1 FROM public.staff_attendance WHERE user_id=_employee AND work_date=_date AND organization_slug=org) THEN
 RAISE EXCEPTION 'Attendance already exists' USING ERRCODE='23505'; END IF;
 INSERT INTO public.staff_attendance(user_id,organization_slug,work_date,check_in_time,check_out_time,break_duration,break_duration_minutes,total_hours,status,notes)
 VALUES(_employee,org,_date,_check_in,_check_out,_break_minutes,_break_minutes,hours,'checked_out',_note) RETURNING * INTO new_row;
 INSERT INTO public.attendance_corrections(organization_slug,attendance_id,actor_id,employee_id,action,reason,after_values)
 VALUES(org,new_row.id,auth.uid(),_employee,'manual',btrim(_reason),to_jsonb(new_row));
 RETURN new_row.id;
END $$;
REVOKE ALL ON FUNCTION public.attendance_correct(uuid,timestamptz,timestamptz,integer,text,text),public.attendance_delete(uuid,text),public.attendance_manual_add(uuid,date,timestamptz,timestamptz,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.attendance_correct(uuid,timestamptz,timestamptz,integer,text,text),public.attendance_delete(uuid,text),public.attendance_manual_add(uuid,date,timestamptz,timestamptz,integer,text,text) TO authenticated;
-- Internal schedule lookup. Drafts are ignored except for their last published snapshot.
CREATE FUNCTION public.hr_published_shift(_org text,_employee uuid,_date date)
 RETURNS TABLE(planned_start timestamptz,planned_end timestamptz) LANGUAGE sql STABLE SET search_path='' AS $$
 WITH entry AS (
 SELECT CASE WHEN e.status='published' THEN to_jsonb(e) ELSE e.published_version END AS j
 FROM public.workforce_staff s JOIN public.workforce_entries e ON e.staff_id=s.id AND e.organization_slug=s.organization_slug
 WHERE s.organization_slug=_org AND s.profile_id=_employee AND e.work_date=_date
 ), times AS (
 SELECT (j->>'start_time')::time AS st,(j->>'end_time')::time AS en FROM entry
 WHERE j->>'kind' IN ('work','night','training','home_office','extra_day')
 )
 SELECT (_date+st) AT TIME ZONE 'Europe/Budapest',
 (_date+en+CASE WHEN en<=st THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE 'Europe/Budapest'
 FROM times WHERE st IS NOT NULL AND en IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.hr_published_shift(text,uuid,date) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_attendance_summary_secure(target_user_id uuid DEFAULT NULL,start_date date DEFAULT (CURRENT_DATE-'30 days'::interval),end_date date DEFAULT CURRENT_DATE)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH days AS (
 SELECT a.user_id,a.work_date,min(a.check_in_time) AS first_in,max(a.check_out_time) AS last_out,
 coalesce(sum(a.total_hours) FILTER (WHERE a.check_out_time IS NOT NULL),0) AS hours
 FROM public.get_attendance_records_hotel_filtered(target_user_id,start_date,end_date) a
 WHERE auth.uid() IS NOT NULL GROUP BY a.user_id,a.work_date
 ), data AS (
 SELECT d.*,s.planned_start,s.planned_end,coalesce(w.punctuality_tolerance_minutes,5) AS tolerance
 FROM days d LEFT JOIN LATERAL public.hr_published_shift(public.get_user_organization_slug(auth.uid()),d.user_id,d.work_date) s ON true
 LEFT JOIN public.workforce_settings w ON w.organization_slug=public.get_user_organization_slug(auth.uid())
 )
 SELECT json_build_object('total_days',count(*),'total_hours',coalesce(sum(hours),0),
 'avg_hours_per_day',coalesce(sum(hours)/nullif(count(*) FILTER(WHERE last_out IS NOT NULL),0),0),
 'completed_days',count(*) FILTER(WHERE last_out IS NOT NULL),
 'scheduled_days',count(*) FILTER(WHERE planned_start IS NOT NULL),
 'no_schedule_days',count(*) FILTER(WHERE planned_start IS NULL),
 'punctual_days',count(*) FILTER(WHERE planned_start IS NOT NULL AND first_in<=planned_start+make_interval(mins=>tolerance)),
 'late_arrivals',count(*) FILTER(WHERE planned_start IS NOT NULL AND first_in>planned_start+make_interval(mins=>tolerance)),
 'early_departures',count(*) FILTER(WHERE last_out IS NOT NULL AND planned_end IS NOT NULL AND last_out<planned_end))
 FROM data
$$;
REVOKE ALL ON FUNCTION public.get_attendance_summary_secure(uuid,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary_secure(uuid,date,date) TO authenticated;
CREATE FUNCTION public.hr_attendance_open_records() RETURNS TABLE(id uuid,user_id uuid,full_name text,work_date date,check_in_time timestamptz,check_out_time timestamptz,break_duration integer,planned_end timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.id,a.user_id,p.full_name,a.work_date,a.check_in_time,a.check_out_time,coalesce(a.break_duration,0),s.planned_end
 FROM public.staff_attendance a JOIN public.profiles p ON p.id=a.user_id AND p.organization_slug=a.organization_slug
 LEFT JOIN LATERAL public.hr_published_shift(a.organization_slug,a.user_id,a.work_date) s ON true
 WHERE auth.uid() IS NOT NULL AND public.is_hr_manager(auth.uid()) AND a.organization_slug=public.get_user_organization_slug(auth.uid())
 AND a.work_date<(now() AT TIME ZONE 'Europe/Budapest')::date AND a.check_out_time IS NULL
 ORDER BY a.work_date,a.check_in_time
$$;
REVOKE ALL ON FUNCTION public.hr_attendance_open_records() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hr_attendance_open_records() TO authenticated;
