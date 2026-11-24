ALTER TABLE public.workforce_entries ADD COLUMN start_time time, ADD COLUMN end_time time, ADD COLUMN published_version jsonb;
CREATE TABLE public.staff_attendance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,organization_slug text,work_date date NOT NULL,check_in_time timestamptz NOT NULL,check_out_time timestamptz,break_duration integer,break_duration_minutes integer,total_hours numeric,status text,notes text,updated_at timestamptz DEFAULT now());
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.staff_attendance TO authenticated;
CREATE POLICY legacy_attendance ON public.staff_attendance FOR ALL TO authenticated USING (organization_slug=public.get_user_organization_slug(auth.uid())) WITH CHECK (organization_slug=public.get_user_organization_slug(auth.uid()));
CREATE OR REPLACE FUNCTION public.get_attendance_records_hotel_filtered(target_user_id uuid DEFAULT NULL,start_date date DEFAULT (CURRENT_DATE-'30 days'::interval),end_date date DEFAULT CURRENT_DATE) RETURNS SETOF public.staff_attendance LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.* FROM public.staff_attendance a JOIN public.profiles p ON p.id=a.user_id AND p.organization_slug=a.organization_slug WHERE a.organization_slug=public.get_user_organization_slug(auth.uid()) AND (target_user_id IS NULL OR a.user_id=target_user_id) AND a.work_date BETWEEN start_date AND end_date
$$;
INSERT INTO public.workforce_entries(staff_id,organization_slug,work_date,kind,status,start_time,end_time) SELECT id,'rdhotels','2025-11-01','work','published','08:00','16:00' FROM public.workforce_staff WHERE profile_id='10000000-0000-0000-0000-000000000009' ON CONFLICT(staff_id,work_date) DO UPDATE SET start_time='08:00',end_time='16:00',status='published',kind='work';
INSERT INTO public.staff_attendance(user_id,organization_slug,work_date,check_in_time,check_out_time,break_duration,total_hours,status)
SELECT '10000000-0000-0000-0000-000000000009','rdhotels','2025-11-01'::date+((i-1)%3),'2025-11-01 07:00+00'::timestamptz+((i-1)%3)*interval '1 day','2025-11-01 15:00+00'::timestamptz+((i-1)%3)*interval '1 day',0,8,'checked_out' FROM generate_series(1,71) i;
INSERT INTO public.staff_attendance(id,user_id,organization_slug,work_date,check_in_time,status) VALUES
 ('92000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','rdhotels','2025-11-04','2025-11-04 07:00+00','checked_in'),
 ('92000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000012','slnt','2025-11-04','2025-11-04 07:00+00','checked_in'),
 ('92000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','rdhotels','2025-11-04','2025-11-04 07:00+00','checked_in');
