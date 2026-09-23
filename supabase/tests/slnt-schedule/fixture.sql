-- Disposable CI database: minimal shape needed to exercise the real SLNT migrations.
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL);
CREATE TABLE public.hotel_configurations (
  hotel_id text PRIMARY KEY, hotel_name text NOT NULL, organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, organization_slug text, assigned_hotel text, hotel_id text,
  role text NOT NULL, deleted_at timestamptz
);
CREATE TABLE public.venues (
  id uuid PRIMARY KEY, hotel_id text, organization_slug text,
  is_active boolean DEFAULT true
);
CREATE TABLE public.user_property_scopes (
  user_id uuid NOT NULL, venue_id uuid NOT NULL,
  organization_slug text NOT NULL, PRIMARY KEY (user_id,venue_id)
);
CREATE TABLE public.staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL,
  hotel_id text NOT NULL, user_id uuid NOT NULL REFERENCES public.profiles(id),
  work_date date NOT NULL, shift_start time NOT NULL, shift_end time NOT NULL,
  status text NOT NULL CHECK(status IN ('draft','published','off')),
  notes text, created_by uuid, published_at timestamptz, published_by uuid,
  UNIQUE (organization_slug,hotel_id,user_id,work_date),
  CHECK (shift_end > shift_start)
);
CREATE TABLE public.staff_schedule_venues (
  schedule_id uuid NOT NULL REFERENCES public.staff_schedules(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venues(id),
  PRIMARY KEY (schedule_id,venue_id)
);
CREATE FUNCTION public.user_can_access_hotel(_uid uuid,_hotel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.profiles p
  JOIN public.organizations o ON o.slug=p.organization_slug
  JOIN public.hotel_configurations h ON h.organization_id=o.id AND h.hotel_id=_hotel
  WHERE p.id=_uid AND p.deleted_at IS NULL
    AND (p.role IN ('admin','top_management','top_management_manager')
      OR p.assigned_hotel IN (h.hotel_id,h.hotel_name)
      OR p.hotel_id=h.hotel_id)
 )
$$;
ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedule_venues ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
GRANT SELECT ON public.profiles,public.venues,public.organizations,public.hotel_configurations,public.user_property_scopes TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.staff_schedules,public.staff_schedule_venues TO authenticated,anon;

INSERT INTO public.organizations(id,slug) VALUES
 ('00000000-0000-4000-8000-000000000001','slnt'),
 ('00000000-0000-4000-8000-000000000002','rdhotels');
INSERT INTO public.hotel_configurations(hotel_id,hotel_name,organization_id) VALUES
 ('slnt-group','SLNT Group','00000000-0000-4000-8000-000000000001'),
 ('rd-test','RD Test','00000000-0000-4000-8000-000000000002');
INSERT INTO public.profiles(id,organization_slug,assigned_hotel,hotel_id,role) VALUES
 ('00000000-0000-4000-8000-000000000010','slnt','slnt-group','slnt-group','admin'),
 ('00000000-0000-4000-8000-000000000011','slnt','slnt-group','slnt-group','manager'),
 ('00000000-0000-4000-8000-000000000012','slnt','slnt-group','slnt-group','supervisor'),
 ('00000000-0000-4000-8000-000000000013','slnt','SLNT Group','slnt-group','housekeeping'),
 ('00000000-0000-4000-8000-000000000014','slnt','SLNT Group','slnt-group','housekeeping'),
 ('00000000-0000-4000-8000-000000000015','slnt','slnt-group','slnt-group','supervisor'),
 ('00000000-0000-4000-8000-000000000020','rdhotels','rd-test','rd-test','admin');
INSERT INTO public.venues(id,hotel_id,organization_slug,is_active) VALUES
 ('00000000-0000-4000-8000-0000000000a1','slnt-group','slnt',true),
 ('00000000-0000-4000-8000-0000000000a2','slnt-group','slnt',true),
 ('00000000-0000-4000-8000-0000000000b1','rd-test','rdhotels',true);
INSERT INTO public.user_property_scopes(user_id,venue_id,organization_slug) VALUES
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-0000000000a1','slnt'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-0000000000a1','slnt'),
 ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-0000000000a1','slnt'),
 ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-0000000000a2','slnt');
