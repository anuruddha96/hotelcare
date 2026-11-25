-- Disposable CI database fixture only; never execute against live HotelCare data.
CREATE SCHEMA IF NOT EXISTS auth;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, role text NOT NULL, assigned_hotel text, organization_slug text
);
CREATE TABLE public.hotel_configurations (hotel_id text PRIMARY KEY, hotel_name text NOT NULL);
CREATE OR REPLACE FUNCTION public.get_hotel_name_from_id(p_hotel text) RETURNS text
LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT hotel_name FROM public.hotel_configurations
  WHERE hotel_id = p_hotel OR hotel_name = p_hotel LIMIT 1), p_hotel);
$$;
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY, department text NOT NULL, hotel text NOT NULL,
  organization_slug text NOT NULL, assigned_to uuid, status text NOT NULL,
  updated_at timestamptz NOT NULL, pending_supervisor_approval boolean DEFAULT false,
  resolution_text text, supervisor_approved boolean, supervisor_approved_at timestamptz,
  supervisor_approved_by uuid, closed_by uuid, closed_at timestamptz,
  on_hold boolean DEFAULT false, hold_reason text
);
CREATE TABLE public.comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id uuid NOT NULL REFERENCES public.tickets(id),
 user_id uuid NOT NULL, organization_slug text, content text NOT NULL,
 created_at timestamptz DEFAULT now()
);
INSERT INTO public.hotel_configurations (hotel_id,hotel_name) VALUES
 ('hotel-a','Hotel A'), ('hotel-b','Hotel B');
INSERT INTO public.profiles (id,role,assigned_hotel,organization_slug) VALUES
 ('00000000-0000-4000-8000-000000000001','manager','hotel-a','rdhotels'),
 ('00000000-0000-4000-8000-000000000002','maintenance','hotel-a','rdhotels'),
 ('00000000-0000-4000-8000-000000000003','manager','hotel-b','rdhotels'),
 ('00000000-0000-4000-8000-000000000004','manager','hotel-a','slnt');
INSERT INTO public.tickets(id,department,hotel,organization_slug,assigned_to,status,updated_at,pending_supervisor_approval,resolution_text) VALUES
 ('00000000-0000-4000-8000-000000000010','maintenance','hotel-a','rdhotels','00000000-0000-4000-8000-000000000002','in_progress','2026-09-21T10:00:00Z',true,'Mirror replaced'),
 ('00000000-0000-4000-8000-000000000011','maintenance','hotel-b','rdhotels','00000000-0000-4000-8000-000000000002','in_progress','2026-09-21T10:00:00Z',true,'Door fixed'),
 ('00000000-0000-4000-8000-000000000012','maintenance','hotel-a','slnt','00000000-0000-4000-8000-000000000002','in_progress','2026-09-21T10:00:00Z',true,'Lamp fixed'),
 ('00000000-0000-4000-8000-000000000013','maintenance','hotel-a','rdhotels','00000000-0000-4000-8000-000000000002','open','2026-09-21T10:00:00Z',false,NULL);
