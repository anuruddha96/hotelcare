-- Minimal stand-ins for the tables the guest journey migration reads. Column
-- names and types follow production (17 Nov 2026).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.reservation_status AS ENUM ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');

CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, hotel_ids text[] NOT NULL DEFAULT '{}');
CREATE TABLE public.hotel_configurations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL UNIQUE,
  hotel_name text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.channex_connections (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, hotel_id text NOT NULL, timezone text);

-- Simplified: staff see the hotels on their profile.
CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(_uid uuid, _hotel_id text, _org_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND _hotel_id = ANY (p.hotel_ids));
$$;

CREATE TABLE public.room_types (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, hotel_id text NOT NULL, name text NOT NULL);
CREATE TABLE public.rooms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel text NOT NULL,
  room_number text NOT NULL,
  room_type text DEFAULT 'standard'::text
);
CREATE TABLE public.guests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text,
  organization_slug text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  nationality text,
  id_document_number text,
  country text,
  vip_status text DEFAULT 'regular'::text,
  notes text,
  company_name text,
  preferences jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE public.reservations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_number text UNIQUE,
  hotel_id text,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  room_type_requested text,
  status public.reservation_status DEFAULT 'pending' NOT NULL,
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  adults integer DEFAULT 1 NOT NULL,
  children integer DEFAULT 0 NOT NULL,
  total_amount numeric(10,2) DEFAULT 0,
  currency text DEFAULT 'HUF'::text,
  source text DEFAULT 'direct'::text,
  special_requests text,
  updated_at timestamptz DEFAULT now() NOT NULL,
  pms_guest_name text,
  pms_contact_name text,
  pms_contact_email text,
  pms_contact_phone text,
  pms_channel text,
  pms_missing_since timestamptz,
  ota_name text,
  room_type_id uuid REFERENCES public.room_types(id) ON DELETE SET NULL
);
CREATE INDEX idx_reservations_guest ON public.reservations (guest_id);

CREATE TABLE public.minibar_items (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, name text NOT NULL, price numeric DEFAULT 0);
CREATE TABLE public.room_minibar_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id uuid,
  minibar_item_id uuid,
  quantity_used integer,
  usage_date timestamptz DEFAULT now()
);
CREATE TABLE public.breakfast_attendance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text,
  stay_date date,
  room_number text,
  served_count integer
);
CREATE TABLE public.insuite_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text,
  room_id uuid,
  reservation_id uuid,
  status text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.insuite_order_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid,
  name_snapshot text,
  quantity integer
);
CREATE TABLE public.insuite_service_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text,
  room_id uuid,
  request_type text,
  created_at timestamptz DEFAULT now()
);

-- ------------------------------------------------------------ seed
INSERT INTO public.organizations (id, slug) VALUES ('00000000-0000-0000-0000-0000000000a1', 'rdhotels');
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, organization_id) VALUES
  ('h1', 'Previo Hotel', '00000000-0000-0000-0000-0000000000a1'),
  ('h2', 'Native Hotel', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.profiles (id, hotel_ids) VALUES
  ('00000000-0000-0000-0000-00000000aaa1', ARRAY['h1', 'h2']),   -- reception at both hotels
  ('00000000-0000-0000-0000-00000000aaa2', ARRAY['other']);      -- someone else's hotel

INSERT INTO public.rooms (id, hotel, room_number, room_type) VALUES
  ('00000000-0000-0000-0000-000000000101', 'h1', '101', 'Dvoulůžkový pokoj'),
  ('00000000-0000-0000-0000-000000000102', 'h1', '102', 'Twin Room'),
  ('00000000-0000-0000-0000-000000000103', 'h1', '103', 'Twin Room'),
  ('00000000-0000-0000-0000-000000000201', 'h2', '201', 'Double');
INSERT INTO public.minibar_items (id, name, price) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'Coca-Cola', 900),
  ('00000000-0000-0000-0000-00000000c002', 'Pringles', 1200);
