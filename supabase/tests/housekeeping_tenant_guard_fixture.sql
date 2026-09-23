-- Disposable PostgreSQL 16 fixture for #352's three migrations. Never use against
-- Supabase production: tables/functions here intentionally model only dependencies.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
CREATE TYPE public.user_role AS ENUM
  ('housekeeping','housekeeping_manager','manager','admin','top_management',
   'top_management_manager','supervisor');
CREATE TABLE public.organizations (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL);
CREATE TABLE public.hotel_configurations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  hotel_id text NOT NULL, hotel_name text NOT NULL
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, organization_slug text NOT NULL, role public.user_role NOT NULL,
  assigned_hotel text, hotel_id text, is_super_admin boolean NOT NULL DEFAULT false,
  deleted_at timestamptz
);
CREATE TABLE public.rooms (id uuid PRIMARY KEY, organization_slug text NOT NULL, hotel text NOT NULL);
CREATE TABLE public.assignment_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL,
  hotel text NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.next_day_housekeeping_plans (
  id uuid PRIMARY KEY, organization_slug text NOT NULL, hotel_id text NOT NULL
);
CREATE TABLE public.next_day_housekeeping_plan_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plan_id uuid NOT NULL
    REFERENCES public.next_day_housekeeping_plans(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id)
);
CREATE TABLE public.next_day_housekeeping_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.next_day_housekeeping_plans(id),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  assigned_to uuid NOT NULL REFERENCES public.profiles(id),
  recommendation_context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  assigned_to uuid NOT NULL REFERENCES public.profiles(id),
  organization_slug text NOT NULL, status text NOT NULL DEFAULT 'assigned'
);
CREATE FUNCTION public.get_user_role(p_user uuid)
RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
 SELECT role FROM public.profiles WHERE id = p_user
$$;
CREATE FUNCTION public.get_user_organization_slug(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT organization_slug FROM public.profiles WHERE id = p_user
$$;
CREATE FUNCTION public.is_super_admin(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE((SELECT is_super_admin FROM public.profiles WHERE id=p_user),false)
$$;
CREATE FUNCTION public.get_hotel_name_from_id(p_hotel text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE((SELECT hotel_name FROM public.hotel_configurations
   WHERE hotel_id=p_hotel OR hotel_name=p_hotel LIMIT 1),p_hotel)
$$;
CREATE FUNCTION public.user_can_access_hotel(p_user uuid,p_hotel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_super_admin(p_user) OR EXISTS (
   SELECT 1 FROM public.profiles p
   WHERE p.id=p_user AND (
     p.assigned_hotel=p_hotel OR p.hotel_id=p_hotel OR
     EXISTS (SELECT 1 FROM public.hotel_configurations hc
       WHERE hc.organization_id=(SELECT id FROM public.organizations
         WHERE slug=p.organization_slug)
       AND (hc.hotel_id=p_hotel OR hc.hotel_name=p_hotel)
       AND (hc.hotel_id=p.assigned_hotel OR hc.hotel_name=p.assigned_hotel
         OR hc.hotel_id=p.hotel_id OR hc.hotel_name=p.hotel_id))
   )
 )
$$;
CREATE FUNCTION public.can_manage_next_day_housekeeping_plan(p_org text,p_hotel text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_super_admin(auth.uid()) OR
   (p_org=public.get_user_organization_slug(auth.uid()) AND
    (public.get_user_role(auth.uid()) IN
       ('admin','top_management','top_management_manager') OR
     (public.get_user_role(auth.uid()) IN ('manager','housekeeping_manager')
       AND public.user_can_access_hotel(auth.uid(),p_hotel))))
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

ALTER TABLE public.assignment_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers and admins can view assignment patterns"
 ON public.assignment_patterns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers and admins can insert assignment patterns"
 ON public.assignment_patterns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Managers and admins can update assignment patterns"
 ON public.assignment_patterns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.next_day_housekeeping_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_plan_select ON public.next_day_housekeeping_plans
 FOR SELECT TO authenticated USING
 (public.can_manage_next_day_housekeeping_plan(organization_slug,hotel_id));
ALTER TABLE public.next_day_housekeeping_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_items_rw ON public.next_day_housekeeping_plan_items
 FOR ALL TO authenticated USING (
 EXISTS(SELECT 1 FROM public.next_day_housekeeping_plans p
 WHERE p.id=plan_id
 AND public.can_manage_next_day_housekeeping_plan(p.organization_slug,p.hotel_id))
 ) WITH CHECK (
 EXISTS(SELECT 1 FROM public.next_day_housekeeping_plans p
 WHERE p.id=plan_id
 AND public.can_manage_next_day_housekeeping_plan(p.organization_slug,p.hotel_id))
 );
ALTER TABLE public.next_day_housekeeping_plan_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_staff_rw ON public.next_day_housekeeping_plan_staff
 FOR ALL TO authenticated USING (
 EXISTS(SELECT 1 FROM public.next_day_housekeeping_plans p
 WHERE p.id=plan_id
 AND public.can_manage_next_day_housekeeping_plan(p.organization_slug,p.hotel_id))
 ) WITH CHECK (
 EXISTS(SELECT 1 FROM public.next_day_housekeeping_plans p
 WHERE p.id=plan_id
 AND public.can_manage_next_day_housekeeping_plan(p.organization_slug,p.hotel_id))
 );
ALTER TABLE public.room_assignments ENABLE ROW LEVEL SECURITY;
-- Historical policy shape is intentionally broad to verify the NEW restrictive
-- policy blocks cross-tenant reads/writes even when another policy allows them.
CREATE POLICY legacy_room_rw ON public.room_assignments
 FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.organizations VALUES
 ('00000000-0000-4000-8000-000000000001','rdhotels'),
 ('00000000-0000-4000-8000-000000000002','slnt'),
 ('00000000-0000-4000-8000-000000000003','test');
INSERT INTO public.hotel_configurations VALUES
 ('00000000-0000-4000-8000-000000000001','mika','Mika'),
 ('00000000-0000-4000-8000-000000000001','memories','Memories'),
 ('00000000-0000-4000-8000-000000000002','slnt-one','SLNT One'),
 ('00000000-0000-4000-8000-000000000003','test-one','Test One');
INSERT INTO public.profiles(id,organization_slug,role,assigned_hotel) VALUES
 ('00000000-0000-4000-8000-000000000011','rdhotels','manager','mika'),
 ('00000000-0000-4000-8000-000000000012','rdhotels','manager','memories'),
 ('00000000-0000-4000-8000-000000000013','slnt','manager','slnt-one'),
 ('00000000-0000-4000-8000-000000000014','rdhotels','housekeeping','mika'),
 ('00000000-0000-4000-8000-000000000015','slnt','housekeeping','slnt-one'),
 ('00000000-0000-4000-8000-000000000016','test','housekeeping','test-one'),
 ('00000000-0000-4000-8000-000000000017','rdhotels','housekeeping','mika'),
 ('00000000-0000-4000-8000-000000000018','rdhotels','top_management',NULL),
 ('00000000-0000-4000-8000-000000000019','rdhotels','housekeeping',NULL);
UPDATE public.profiles SET is_super_admin = true
 WHERE id='00000000-0000-4000-8000-000000000019';
UPDATE public.profiles SET deleted_at=now()
 WHERE id='00000000-0000-4000-8000-000000000017';
INSERT INTO public.rooms(id,organization_slug,hotel) VALUES
 ('00000000-0000-4000-8000-000000000021','rdhotels','mika'),
 ('00000000-0000-4000-8000-000000000022','rdhotels','memories'),
 ('00000000-0000-4000-8000-000000000023','slnt','slnt-one'),
 ('00000000-0000-4000-8000-000000000024','test','test-one');
INSERT INTO public.next_day_housekeeping_plans VALUES
 ('00000000-0000-4000-8000-000000000031','rdhotels','mika'),
 ('00000000-0000-4000-8000-000000000032','slnt','slnt-one');
INSERT INTO public.next_day_housekeeping_plan_staff(plan_id,user_id) VALUES
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000014'),
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000017');
INSERT INTO public.next_day_housekeeping_plan_items(plan_id,room_id,assigned_to) VALUES
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000014');
INSERT INTO public.assignment_patterns(organization_slug,hotel) VALUES
 ('rdhotels','mika'),('rdhotels','memories'),('slnt','slnt-one');
-- Legacy mislinked work, inserted BEFORE migration and preserved for audit.
INSERT INTO public.room_assignments(room_id,assigned_to,organization_slug,status) VALUES
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000015','rdhotels','in_progress'),
 ('00000000-0000-4000-8000-000000000024','00000000-0000-4000-8000-000000000014','rdhotels','assigned');
