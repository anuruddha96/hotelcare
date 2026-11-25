-- Minimal stand-ins for the Supabase/HotelCare objects the Channex migration depends on.
-- Disposable PostgreSQL only (CI). Never run against a real project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql AS $$ SELECT public.gen_random_bytes($1) $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets_store (name text PRIMARY KEY, secret text NOT NULL);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT name, secret AS decrypted_secret FROM vault.secrets_store;
CREATE OR REPLACE FUNCTION vault.create_secret(p_secret text, p_name text, p_description text, p_key uuid)
RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets_store VALUES (p_name, p_secret); SELECT gen_random_uuid(); $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, organization_slug text, assigned_hotel text, is_super_admin boolean DEFAULT false);

CREATE OR REPLACE FUNCTION public.has_pms_access(user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = user_id AND role IN ('admin','manager','reception','front_office','housekeeping_manager','top_management'));
$$;
-- Simplified: same organisation and assigned hotel (or admin of that organisation).
CREATE TABLE public.hotel_org (hotel_id text PRIMARY KEY, organization_slug text NOT NULL);
CREATE OR REPLACE FUNCTION public.user_can_access_hotel(_uid uuid, _hotel_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p JOIN hotel_org h ON h.hotel_id = _hotel_id
    WHERE p.id = _uid AND (p.is_super_admin OR (p.organization_slug = h.organization_slug AND (p.role IN ('admin','top_management') OR p.assigned_hotel = _hotel_id)))
  );
$$;

CREATE TABLE public.rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel text, room_number text, room_type text);
CREATE TABLE public.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text, organization_slug text,
  first_name text NOT NULL, last_name text NOT NULL, email text, phone text, country text, notes text
);
CREATE TYPE public.reservation_status AS ENUM ('pending','confirmed','checked_in','checked_out','cancelled','no_show');
CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reservation_number text, hotel_id text, organization_slug text,
  guest_id uuid REFERENCES public.guests(id), room_id uuid REFERENCES public.rooms(id), room_type_requested text,
  status public.reservation_status NOT NULL DEFAULT 'pending', check_in_date date NOT NULL, check_out_date date NOT NULL,
  adults integer NOT NULL DEFAULT 1, children integer NOT NULL DEFAULT 0, rate_per_night numeric(10,2) DEFAULT 0,
  total_amount numeric(10,2) DEFAULT 0, currency text DEFAULT 'HUF', payment_status text DEFAULT 'unpaid',
  source text DEFAULT 'direct', source_reservation_id text, special_requests text, pms_guest_name text,
  cancelled_at timestamptz, cancellation_reason text, updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text NOT NULL, organization_slug text NOT NULL,
  name text NOT NULL, num_rooms integer NOT NULL DEFAULT 1, is_sellable boolean NOT NULL DEFAULT true
);
CREATE TABLE public.revenue_room_type_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text NOT NULL, stay_date date NOT NULL, room_type_name text,
  rate_plan_id text NOT NULL DEFAULT 'base', occupancy integer NOT NULL DEFAULT 2, price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR', min_stay integer, closed_to_arrival boolean NOT NULL DEFAULT false,
  closed_to_departure boolean NOT NULL DEFAULT false, captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.revenue_rate_push_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text, stay_date date, room_type_name text,
  occupancy integer, target_price numeric, currency text
);
