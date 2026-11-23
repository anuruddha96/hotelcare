-- Phase 4 SQL acceptance fixture; disposable PostgreSQL 16 ONLY.
-- First run supabase/tests/ntak_fixture.sql in a fresh CI database.
ALTER TABLE public.rooms ADD COLUMN organization_slug text;

CREATE OR REPLACE FUNCTION public.pms_hotel_room_keys(_id text)
RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN _id='channex-test-property'
    THEN 'Test Property - HotelCare' ELSE 'Different Hotel' END
$$;

CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(_actor uuid,_hotel text,_org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.hotel_access a ON a.user_id=p.id
    WHERE p.id=_actor AND p.organization_slug=_org AND a.hotel_id=_hotel
  )
$$;

-- Production has pg_cron already; the test database uses a no-op scheduler.
-- The actual migration remains unchanged and is applied verbatim.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE OR REPLACE FUNCTION cron.schedule(_name text, _pattern text, _sql text)
RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

GRANT SELECT ON public.profiles TO authenticated;

INSERT INTO public.profiles(id,role,organization_slug) VALUES
  ('00000000-0000-4000-8000-000000000071','manager','channex'),
  ('00000000-0000-4000-8000-000000000072','housekeeping','channex'),
  ('00000000-0000-4000-8000-000000000073','manager','other');
INSERT INTO public.hotel_access(user_id,hotel_id) VALUES
  ('00000000-0000-4000-8000-000000000071','channex-test-property'),
  ('00000000-0000-4000-8000-000000000072','channex-test-property'),
  ('00000000-0000-4000-8000-000000000073','different-hotel');

INSERT INTO public.rooms(id,hotel,organization_slug,room_number,status)
VALUES
  ('00000000-0000-4000-8000-000000000101','Test Property - HotelCare','channex','101','clean'),
  ('00000000-0000-4000-8000-000000000102','Test Property - HotelCare','channex','102','dirty'),
  ('00000000-0000-4000-8000-000000000103','Test Property - HotelCare','channex','103','clean'),
  ('00000000-0000-4000-8000-000000000104','Test Property - HotelCare','channex','104','clean'),
  ('00000000-0000-4000-8000-000000000105','Different Hotel','other','901','clean');
