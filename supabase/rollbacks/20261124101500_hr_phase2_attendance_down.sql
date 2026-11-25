-- Preserve audit and tolerance data on rollback. Disable new API and restore old summary.
DROP FUNCTION IF EXISTS public.hr_attendance_open_records();
CREATE OR REPLACE FUNCTION public.get_attendance_summary_secure(target_user_id uuid DEFAULT NULL,start_date date DEFAULT (CURRENT_DATE-'30 days'::interval),end_date date DEFAULT CURRENT_DATE)
 RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT json_build_object('total_days',count(DISTINCT work_date),'total_hours',coalesce(sum(total_hours),0),
 'avg_hours_per_day',coalesce(sum(total_hours)/nullif(count(DISTINCT work_date),0),0),
 'punctual_days',count(*) FILTER(WHERE check_in_time::time<='09:00'::time),
 'late_arrivals',count(*) FILTER(WHERE check_in_time::time>'09:00'::time),
 'early_departures',count(*) FILTER(WHERE check_out_time::time<'17:00'::time))
 FROM public.get_attendance_records_hotel_filtered(target_user_id,start_date,end_date)
$$;
DROP FUNCTION IF EXISTS public.hr_published_shift(text,uuid,date);
DROP FUNCTION IF EXISTS public.attendance_correct(uuid,timestamptz,timestamptz,integer,text,text);
DROP FUNCTION IF EXISTS public.attendance_delete(uuid,text);
DROP FUNCTION IF EXISTS public.attendance_manual_add(uuid,date,timestamptz,timestamptz,integer,text,text);
DROP FUNCTION IF EXISTS public.hr_attendance_actor_org(uuid,text);
DROP FUNCTION IF EXISTS public.hr_attendance_hours(date,timestamptz,timestamptz,integer,text);
DROP POLICY IF EXISTS hr_attendance_insert_scope ON public.staff_attendance;
DROP POLICY IF EXISTS hr_attendance_update_scope ON public.staff_attendance;
DROP POLICY IF EXISTS hr_attendance_delete_scope ON public.staff_attendance;
-- attendance_corrections is retained as an immutable audit record; never drop production history.
