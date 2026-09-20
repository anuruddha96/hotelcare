-- Minimal isolated schema for CI. Never run against the live HotelCare database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE TABLE public.organizations (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE);
CREATE TABLE public.hotel_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text NOT NULL,
  hotel_name text NOT NULL, organization_id uuid NOT NULL REFERENCES public.organizations(id)
);
CREATE TABLE public.housekeeping_automation_settings (
  organization_slug text NOT NULL, hotel_id text NOT NULL, timezone text
);
CREATE FUNCTION public.can_manage_next_day_housekeeping_plan(text,text)
RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel text NOT NULL,
  organization_slug text NOT NULL, pms_metadata jsonb,
  guest_nights_stayed integer, is_checkout_room boolean DEFAULT false,
  towel_change_required boolean DEFAULT false, linen_change_required boolean DEFAULT false,
  last_towel_change date, last_linen_change date
);
CREATE TABLE public.room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text
);
CREATE PUBLICATION supabase_realtime;
