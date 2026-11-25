-- Extra stand-ins for the native rates & availability migrations (CI only, after channex_fixture.sql).
-- Disposable PostgreSQL only. Never run against a real project.
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text UNIQUE NOT NULL,
  is_active boolean, subscription_tier text DEFAULT 'basic', settings jsonb);
CREATE TABLE public.hotel_configurations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text UNIQUE NOT NULL, hotel_name text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id), is_active boolean, settings jsonb, market_city text, market_country text);
CREATE TABLE public.organization_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL,
  setting_key text NOT NULL, setting_value jsonb NOT NULL, UNIQUE (organization_slug, setting_key));
CREATE TABLE public.rate_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text, organization_slug text, name text NOT NULL,
  room_type text, base_rate numeric(10,2) NOT NULL DEFAULT 0, currency text DEFAULT 'HUF', is_active boolean DEFAULT true,
  min_stay integer DEFAULT 1, max_stay integer, meal_plan text DEFAULT 'room_only');
ALTER TABLE public.room_types
  ADD COLUMN counts_toward_inventory boolean NOT NULL DEFAULT true, ADD COLUMN base_price_eur numeric NOT NULL DEFAULT 0,
  ADD COLUMN min_price_eur numeric NOT NULL DEFAULT 0, ADD COLUMN max_price_eur numeric NOT NULL DEFAULT 9999,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.rooms
  ADD COLUMN organization_slug text, ADD COLUMN room_name text, ADD COLUMN room_category text,
  ADD COLUMN room_capacity integer, ADD COLUMN floor_number integer, ADD COLUMN status text;
ALTER TABLE public.reservations ADD COLUMN actual_check_in timestamptz, ADD COLUMN pms_missing_since timestamptz;
ALTER TABLE public.guests ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX uq_reservations_hotel_source_ref ON public.reservations(hotel_id, source, source_reservation_id);
CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(_uid uuid, _hotel_id text, _org_slug text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_pms_access(_uid) AND public.user_can_access_hotel(_uid, _hotel_id) $$;

INSERT INTO public.organizations (name, slug) VALUES ('RD Hotels', 'rdhotels');
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, organization_id, settings)
SELECT 'memories-budapest', 'Hotel Memories Budapest', id, '{"modules":{"housekeeping":true},"manager_email":"x@y"}' FROM public.organizations WHERE slug = 'rdhotels';
INSERT INTO public.organization_settings (organization_slug, setting_key, setting_value) VALUES ('rdhotels', 'enabled_modules', '{"x":1}');
