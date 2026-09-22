-- Disposable CI schema only. NEVER run this fixture in production.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.test_user_id', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.organizations(id uuid PRIMARY KEY, slug text NOT NULL UNIQUE);
CREATE TABLE public.hotel_configurations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL UNIQUE, hotel_name text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rooms(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel text NOT NULL, organization_slug text NOT NULL,
  room_number text NOT NULL, status text DEFAULT 'dirty',
  pms_metadata jsonb, guest_nights_stayed integer,
  is_checkout_room boolean DEFAULT false,
  towel_change_required boolean DEFAULT false,
  linen_change_required boolean DEFAULT false,
  last_towel_change date, last_linen_change date
);
CREATE TABLE public.room_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text);
CREATE TABLE public.pms_change_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL, room_id uuid, room_label text,
  event_type text NOT NULL, source text NOT NULL,
  before jsonb, after jsonb, category text
);
CREATE FUNCTION public.can_manage_next_day_housekeeping_plan(p_slug text,p_hotel text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT auth.uid() = '11111111-1111-4111-8111-111111111111'::uuid
     AND p_slug = 'rdhotels' AND p_hotel = 'memories-budapest'
$$;
INSERT INTO organizations(id,slug) VALUES
('22222222-2222-4222-8222-222222222222','rdhotels'),
('33333333-3333-4333-8333-333333333333','other-tenant');
INSERT INTO hotel_configurations(hotel_id,hotel_name,organization_id) VALUES
('memories-budapest','Hotel Memories Budapest','22222222-2222-4222-8222-222222222222'),
('mika-downtown','Hotel Mika Downtown','22222222-2222-4222-8222-222222222222'),
('other','Other Tenant','33333333-3333-4333-8333-333333333333');
