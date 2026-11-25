-- Minimal stand-ins for the Supabase/HotelCare objects the NTAK migration depends on.
-- Disposable PostgreSQL only (CI). Never run against a real project.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

-- Vault with the two functions the migration uses.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text NOT NULL, description text);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $$ INSERT INTO vault.secrets (name, secret, description) VALUES (new_name, new_secret, new_description) RETURNING id $$;
CREATE OR REPLACE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL, new_description text DEFAULT NULL, new_key_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$ UPDATE vault.secrets SET secret = COALESCE(new_secret, secret) WHERE id = secret_id $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text, organization_slug text, assigned_hotel text, is_super_admin boolean DEFAULT false);
CREATE TABLE public.hotel_access (user_id uuid, hotel_id text);

CREATE OR REPLACE FUNCTION public.has_pms_access(user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = user_id AND role IN ('admin','manager','reception','front_office'));
$$;
CREATE OR REPLACE FUNCTION public.user_can_access_hotel(_uid uuid, _hotel_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM hotel_access WHERE user_id = _uid AND hotel_id = _hotel_id);
$$;
CREATE OR REPLACE FUNCTION public.get_channex_worker_secret() RETURNS text LANGUAGE sql AS $$ SELECT 'ci-secret' $$;

CREATE TYPE public.reservation_status AS ENUM ('pending','confirmed','checked_in','checked_out','cancelled','no_show');

CREATE TABLE public.rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel text NOT NULL, room_number text NOT NULL, status text);
CREATE TABLE public.room_types (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text, name text);
CREATE TABLE public.guests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text NOT NULL, last_name text NOT NULL, hotel_id text);
CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text, organization_slug text,
  guest_id uuid REFERENCES public.guests(id),
  room_id uuid REFERENCES public.rooms(id),
  room_type_id uuid,
  status public.reservation_status NOT NULL DEFAULT 'confirmed',
  check_in_date date NOT NULL, check_out_date date NOT NULL,
  adults integer NOT NULL DEFAULT 1, children integer NOT NULL DEFAULT 0,
  total_amount numeric, currency text, source text, ota_name text,
  channex_booking_id text, pms_reservation_id text, reservation_number text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.can_access_reservation(_uid uuid, _reservation_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM reservations r JOIN hotel_access a ON a.hotel_id = r.hotel_id WHERE r.id = _reservation_id AND a.user_id = _uid);
$$;

GRANT SELECT ON public.reservations, public.guests, public.rooms TO authenticated;
