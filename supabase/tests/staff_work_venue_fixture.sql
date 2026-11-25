-- Disposable PostgreSQL fixture for cross-property staff work venue.
CREATE SCHEMA auth;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TYPE public.user_role AS ENUM ('housekeeping','maintenance','maintenance_manager','manager','admin');
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.hotel_configurations (
  hotel_id text PRIMARY KEY,
  hotel_name text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role public.user_role NOT NULL,
  organization_slug text NOT NULL,
  assigned_hotel text,
  deleted_at timestamptz,
  deleted_by uuid,
  hotel_id text,
  acts_as_housekeeper boolean NOT NULL DEFAULT false,
  is_super_admin boolean NOT NULL DEFAULT false
);
CREATE TABLE public.department_access_config (
  role public.user_role NOT NULL,
  department text NOT NULL,
  access_scope text NOT NULL,
  can_manage_all boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role,department)
);
CREATE OR REPLACE FUNCTION public.get_hotel_name_from_id(v text)
RETURNS text LANGUAGE sql STABLE AS $$
 SELECT COALESCE(
   (SELECT hotel_name FROM public.hotel_configurations WHERE hotel_id=v LIMIT 1),
   v
 );
$$;
CREATE OR REPLACE FUNCTION public.is_super_admin(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT coalesce((SELECT is_super_admin FROM public.profiles WHERE id=p_user), false);
$$;
CREATE OR REPLACE FUNCTION public.get_user_role(p_user uuid)
RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT role FROM public.profiles WHERE id=p_user;
$$;
CREATE OR REPLACE FUNCTION public.hotel_belongs_to_user_organization(p_user uuid, p_hotel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.profiles p JOIN public.organizations o ON o.slug=p.organization_slug
   JOIN public.hotel_configurations h ON h.organization_id=o.id
   WHERE p.id=p_user AND h.is_active AND o.is_active
     AND (h.hotel_id=p_hotel OR h.hotel_name=p_hotel)
 );
$$;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.hotel_configurations, public.organizations TO authenticated;

INSERT INTO public.organizations(id,slug) VALUES
('aaaaaaaa-0000-4000-8000-000000000001','rdhotels'),
('aaaaaaaa-0000-4000-8000-000000000002','otherorg');

INSERT INTO public.hotel_configurations(hotel_id,hotel_name,organization_id,is_active) VALUES
('memories-budapest','Hotel Memories Budapest','aaaaaaaa-0000-4000-8000-000000000001',true),
('ottofiori','Hotel Ottofiori','aaaaaaaa-0000-4000-8000-000000000001',true),
('inactive','Inactive Hotel','aaaaaaaa-0000-4000-8000-000000000001',false),
('other-hotel','Other Organization Hotel','aaaaaaaa-0000-4000-8000-000000000002',true);

INSERT INTO public.profiles(id,role,organization_slug,assigned_hotel) VALUES
('00000000-0000-4000-8000-000000000001','maintenance','rdhotels','memories-budapest'),
('00000000-0000-4000-8000-000000000002','housekeeping','rdhotels','memories-budapest'),
('00000000-0000-4000-8000-000000000003','maintenance','otherorg','other-hotel'),
('00000000-0000-4000-8000-000000000004','maintenance_manager','rdhotels','memories-budapest');
