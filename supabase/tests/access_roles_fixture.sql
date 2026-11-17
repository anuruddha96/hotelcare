-- Disposable PostgreSQL fixture for 20261117200000_access_roles_and_mira_actions.sql.
-- Only the objects that migration touches, with production signatures.
CREATE SCHEMA IF NOT EXISTS auth;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

CREATE TYPE public.user_role AS ENUM (
  'housekeeping', 'reception', 'maintenance', 'manager', 'admin', 'marketing', 'control_finance', 'hr',
  'front_office', 'top_management', 'housekeeping_manager', 'maintenance_manager', 'marketing_manager',
  'reception_manager', 'back_office_manager', 'control_manager', 'finance_manager', 'top_management_manager',
  'breakfast_staff', 'back_office', 'supervisor'
);

CREATE TABLE public.organizations (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.hotel_configurations (
  hotel_id text PRIMARY KEY, hotel_name text NOT NULL, organization_id uuid REFERENCES public.organizations(id), is_active boolean DEFAULT true
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  email text,
  full_name text,
  nickname text,
  role public.user_role NOT NULL,
  organization_slug text,
  assigned_hotel text,
  is_super_admin boolean DEFAULT false,
  deleted_at timestamptz,
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_super_admin FROM public.profiles WHERE id = _uid), false)
$$;
CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid) RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT role FROM public.profiles WHERE id = user_id $$;
CREATE OR REPLACE FUNCTION public.get_user_organization_slug(user_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT organization_slug FROM public.profiles WHERE id = user_id $$;
CREATE OR REPLACE FUNCTION public.is_top_management(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.role IN ('top_management', 'top_management_manager'))
$$;

-- Same-organization profile updates, as in production (top management is not in it).
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Staff view permitted profiles in their organization" ON public.profiles FOR SELECT TO authenticated
  USING (organization_slug = public.get_user_organization_slug(auth.uid()) AND deleted_at IS NULL
         AND public.get_user_role(auth.uid()) IN ('admin', 'hr', 'housekeeping_manager', 'manager', 'top_management', 'top_management_manager'));
CREATE POLICY "Managers update permitted profiles in their organization" ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (organization_slug = public.get_user_organization_slug(auth.uid())
         AND public.get_user_role(auth.uid()) IN ('admin', 'housekeeping_manager', 'manager')))
  WITH CHECK (public.is_super_admin(auth.uid()) OR (organization_slug = public.get_user_organization_slug(auth.uid())
         AND public.get_user_role(auth.uid()) IN ('admin', 'housekeeping_manager', 'manager')));

-- Work schedule
CREATE TABLE public.workforce_departments (id uuid PRIMARY KEY, organization_slug text NOT NULL, name text NOT NULL);
CREATE TABLE public.workforce_job_roles (id uuid PRIMARY KEY, organization_slug text NOT NULL, department_id uuid, name text NOT NULL);
CREATE TABLE public.workforce_staff (
  id uuid PRIMARY KEY, organization_slug text NOT NULL, full_name text NOT NULL, department_id uuid, job_role_id uuid,
  hotel_id text, profile_id uuid, is_active boolean NOT NULL DEFAULT true, daily_hours numeric DEFAULT 8,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.workforce_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL, staff_id uuid NOT NULL REFERENCES public.workforce_staff(id),
  work_date date NOT NULL, kind text NOT NULL DEFAULT 'work', status text NOT NULL DEFAULT 'draft', hotel_id text,
  UNIQUE (staff_id, work_date)
);
GRANT SELECT ON public.workforce_staff, public.workforce_entries TO authenticated;

CREATE OR REPLACE FUNCTION public.workforce_hotel_key(_org text, _value text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT h.hotel_id FROM public.hotel_configurations h JOIN public.organizations o ON o.id = h.organization_id
      WHERE o.slug = _org AND (lower(h.hotel_id) = lower(btrim(_value)) OR lower(h.hotel_name) = lower(btrim(_value))) LIMIT 1),
    NULLIF(btrim(_value), ''))
$$;
CREATE OR REPLACE FUNCTION public.workforce_staff_hotel(_staff uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT s.hotel_id FROM public.workforce_staff s WHERE s.id = _staff $$;
CREATE OR REPLACE FUNCTION public.workforce_staff_is_mine(_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.workforce_staff s WHERE s.id = _staff AND s.profile_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.workforce_staff_works_at(_staff uuid, _hotel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _hotel IS NOT NULL AND EXISTS (SELECT 1 FROM public.workforce_entries e WHERE e.staff_id = _staff AND e.hotel_id = _hotel)
$$;

-- Production definition before this migration.
CREATE OR REPLACE FUNCTION public.workforce_access()
RETURNS TABLE(organization_slug text, access_level text, hotel_id text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.organization_slug,
         CASE
           WHEN p.is_super_admin IS TRUE OR p.role::text IN ('admin', 'top_management', 'top_management_manager', 'hr') THEN 'org'
           WHEN p.role::text IN ('manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager',
                                 'back_office_manager', 'finance_manager', 'control_manager', 'marketing_manager') THEN 'property'
           ELSE 'self'
         END,
         public.workforce_hotel_key(p.organization_slug, p.assigned_hotel),
         CASE WHEN p.is_super_admin IS TRUE THEN 'admin' ELSE p.role::text END
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

ALTER TABLE public.workforce_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workforce read staff" ON public.workforce_staff FOR SELECT TO authenticated USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND ((SELECT a.access_level FROM public.workforce_access() a) = 'org' OR profile_id = (SELECT auth.uid())));
CREATE POLICY "workforce read entries" ON public.workforce_entries FOR SELECT TO authenticated USING (
  organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a)
  AND ((SELECT a.access_level FROM public.workforce_access() a) = 'org'
       OR (status = 'published' AND public.workforce_staff_is_mine(staff_id))));

-- Data: two organizations, the RD Hotels people this migration is about.
INSERT INTO public.organizations VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'rdhotels', true),
  ('00000000-0000-0000-0000-0000000000a2', 'slnt', true);
INSERT INTO public.hotel_configurations VALUES
  ('memories-budapest', 'Hotel Memories Budapest', '00000000-0000-0000-0000-0000000000a1', true),
  ('gozsdu-court', 'Gozsdu Court Budapest', '00000000-0000-0000-0000-0000000000a1', true),
  ('mika-downtown', 'Hotel Mika Downtown', '00000000-0000-0000-0000-0000000000a1', true),
  ('ottofiori', 'Hotel Ottofiori', '00000000-0000-0000-0000-0000000000a1', true);

INSERT INTO public.profiles (id, full_name, nickname, role, organization_slug, assigned_hotel, is_super_admin) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Anu', 'Anu_000', 'top_management_manager', 'rdhotels', 'ottofiori', false),
  ('10000000-0000-0000-0000-000000000002', 'Laura - Control', 'Laura_081', 'top_management_manager', 'rdhotels', 'gozsdu-court', false),
  ('10000000-0000-0000-0000-000000000003', 'Petra Lengyel', 'Petra_006', 'manager', 'rdhotels', 'ottofiori', false),
  ('10000000-0000-0000-0000-000000000004', 'Klaudia Antal', 'Klau_127', 'manager', 'rdhotels', 'gozsdu-court', false),
  ('10000000-0000-0000-0000-000000000005', 'Macsko Éva', 'Éva_0005', 'manager', 'rdhotels', 'gozsdu-court', false),
  ('10000000-0000-0000-0000-000000000006', 'Baska', 'Baska_007', 'manager', 'rdhotels', 'memories-budapest', false),
  ('10000000-0000-0000-0000-000000000007', 'Ashesh Kaushal', 'AsheshK', 'manager', 'rdhotels', 'memories-budapest', false),
  ('10000000-0000-0000-0000-000000000008', 'Brigi', 'Brigi_107', 'manager', 'rdhotels', 'mika-downtown', false),
  ('10000000-0000-0000-0000-000000000009', 'Room attendant', 'ra_1', 'housekeeping', 'rdhotels', 'memories-budapest', false),
  ('10000000-0000-0000-0000-000000000010', 'Technician', 'tech_1', 'maintenance', 'rdhotels', 'memories-budapest', false),
  ('10000000-0000-0000-0000-000000000011', 'RD admin', 'dinuka_0002', 'admin', 'rdhotels', NULL, false),
  ('10000000-0000-0000-0000-000000000012', 'SLNT top', 'Csaba_002', 'top_management_manager', 'slnt', 'slnt-group', false);

INSERT INTO public.workforce_departments VALUES
  ('20000000-0000-0000-0000-000000000001', 'rdhotels', 'Housekeeping'),
  ('20000000-0000-0000-0000-000000000002', 'rdhotels', 'Reception');
INSERT INTO public.workforce_job_roles VALUES
  ('30000000-0000-0000-0000-000000000001', 'rdhotels', '20000000-0000-0000-0000-000000000001', 'Housekeeping manager'),
  ('30000000-0000-0000-0000-000000000002', 'rdhotels', '20000000-0000-0000-0000-000000000001', 'Supervisor'),
  ('30000000-0000-0000-0000-000000000003', 'rdhotels', '20000000-0000-0000-0000-000000000001', 'Room attendant'),
  ('30000000-0000-0000-0000-000000000004', 'rdhotels', '20000000-0000-0000-0000-000000000002', 'Front office manager'),
  ('30000000-0000-0000-0000-000000000005', 'rdhotels', '20000000-0000-0000-0000-000000000002', 'Reception lead'),
  ('30000000-0000-0000-0000-000000000006', 'rdhotels', '20000000-0000-0000-0000-000000000002', 'Receptionist');

INSERT INTO public.workforce_staff (id, organization_slug, full_name, department_id, job_role_id, hotel_id, profile_id) VALUES
  ('40000000-0000-0000-0000-000000000003', 'rdhotels', 'Petra Lengyel', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 'memories-budapest', '10000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000004', 'rdhotels', 'Klaudia Antal', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000005', 'gozsdu-court', '10000000-0000-0000-0000-000000000004'),
  ('40000000-0000-0000-0000-000000000005', 'rdhotels', 'Macsko Éva', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'memories-budapest', '10000000-0000-0000-0000-000000000005'),
  ('40000000-0000-0000-0000-000000000006', 'rdhotels', 'Baska', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'memories-budapest', '10000000-0000-0000-0000-000000000006'),
  ('40000000-0000-0000-0000-000000000007', 'rdhotels', 'Ashesh Kaushal', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000006', 'memories-budapest', '10000000-0000-0000-0000-000000000007'),
  ('40000000-0000-0000-0000-000000000009', 'rdhotels', 'Room attendant', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'memories-budapest', '10000000-0000-0000-0000-000000000009'),
  ('40000000-0000-0000-0000-000000000010', 'rdhotels', 'Technician', NULL, NULL, 'memories-budapest', '10000000-0000-0000-0000-000000000010'),
  ('40000000-0000-0000-0000-000000000020', 'rdhotels', 'Gozsdu attendant', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'gozsdu-court', NULL);

INSERT INTO public.workforce_entries (organization_slug, staff_id, work_date, kind, status, hotel_id) VALUES
  ('rdhotels', '40000000-0000-0000-0000-000000000009', '2026-12-01', 'work', 'published', 'memories-budapest'),
  ('rdhotels', '40000000-0000-0000-0000-000000000010', '2026-12-01', 'work', 'published', 'memories-budapest'),
  ('rdhotels', '40000000-0000-0000-0000-000000000020', '2026-12-01', 'work', 'published', 'gozsdu-court'),
  ('rdhotels', '40000000-0000-0000-0000-000000000005', '2026-12-01', 'work', 'published', 'memories-budapest');
