-- Disposable PostgreSQL fixture only; not a production schema clone.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_slug text,role text,access_role text,assigned_hotel text,deleted_at timestamptz);
CREATE TABLE public.organizations(id uuid PRIMARY KEY,slug text,is_active boolean);
CREATE TABLE public.hotel_configurations(hotel_id text,hotel_name text,organization_id uuid,is_active boolean);
CREATE TABLE public.workforce_staff(id uuid PRIMARY KEY,organization_slug text,profile_id uuid);
CREATE TABLE public.workforce_entries(staff_id uuid,organization_slug text,work_date date,status text,kind text,start_time time,end_time time,extra_minutes integer,published_version jsonb);
CREATE TABLE public.staff_attendance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,organization_slug text,work_date date NOT NULL DEFAULT current_date,check_in_time timestamptz NOT NULL DEFAULT now(),check_out_time timestamptz,status text,break_duration integer,break_duration_minutes integer,break_started_at timestamptz,break_ended_at timestamptz,total_hours numeric,notes text,updated_at timestamptz DEFAULT now());
CREATE TABLE public.early_signout_requests(attendance_id uuid,organization_slug text,status text);
CREATE FUNCTION public.effective_access_role(a text,r text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT coalesce(a,r)$$;
CREATE FUNCTION public.get_user_organization_slug(u uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT organization_slug FROM public.profiles WHERE id=u$$;
CREATE FUNCTION public.is_hr_manager(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND u=auth.uid() AND role IN ('hr','admin'))$$;
CREATE FUNCTION public.is_top_management(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
CREATE FUNCTION public.workforce_hotel_key(o text,v text) RETURNS text LANGUAGE sql STABLE AS $$SELECT v$$;
CREATE FUNCTION public.user_can_access_hotel(u uuid,h text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.organizations o ON o.slug=p.organization_slug JOIN public.hotel_configurations c ON c.organization_id=o.id WHERE p.id=u AND c.hotel_id=h AND p.assigned_hotel=h)$$;
CREATE FUNCTION public.calculate_work_hours() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
CREATE TRIGGER calculate_work_hours_trigger BEFORE UPDATE ON public.staff_attendance FOR EACH ROW EXECUTE FUNCTION public.calculate_work_hours();
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON public.staff_attendance TO authenticated;
CREATE POLICY own_attendance ON public.staff_attendance TO authenticated USING(user_id=auth.uid() AND organization_slug=public.get_user_organization_slug(auth.uid())) WITH CHECK(user_id=auth.uid() AND organization_slug=public.get_user_organization_slug(auth.uid()));
INSERT INTO public.organizations VALUES('aaaaaaaa-0000-0000-0000-000000000001','rdhotels',true),('aaaaaaaa-0000-0000-0000-000000000002','slnt',true);
INSERT INTO public.hotel_configurations VALUES('mika-downtown','Mika','aaaaaaaa-0000-0000-0000-000000000001',true),('foreign','Foreign','aaaaaaaa-0000-0000-0000-000000000002',true);
INSERT INTO public.profiles(id,organization_slug,role,assigned_hotel) VALUES
 ('10000000-0000-0000-0000-000000000001','rdhotels','housekeeping','mika-downtown'),
 ('10000000-0000-0000-0000-000000000002','rdhotels','reception','mika-downtown'),
 ('10000000-0000-0000-0000-000000000003','rdhotels','reception','mika-downtown'),
 ('10000000-0000-0000-0000-000000000004','rdhotels','housekeeping','mika-downtown'),
 ('10000000-0000-0000-0000-000000000005','slnt','housekeeping','foreign'),
 ('10000000-0000-0000-0000-000000000006','rdhotels','hr','mika-downtown'),
 ('10000000-0000-0000-0000-000000000007','rdhotels','housekeeping','mika-downtown');
INSERT INTO public.workforce_staff VALUES
 ('20000000-0000-0000-0000-000000000002','rdhotels','10000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003','rdhotels','10000000-0000-0000-0000-000000000003');
INSERT INTO public.workforce_entries VALUES
 ('20000000-0000-0000-0000-000000000002','rdhotels','2026-11-27','published','work','12:00','20:00',30,NULL),
 ('20000000-0000-0000-0000-000000000003','rdhotels','2026-11-26','draft','work','08:00','16:00',0,'{"kind":"night","start_time":"20:00","end_time":"08:00","extra_minutes":0}');
