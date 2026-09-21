CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.organizations (id uuid PRIMARY KEY, slug text NOT NULL UNIQUE);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, organization_slug text, deleted_at timestamptz
);
CREATE TABLE public.hotel_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hotel_id text NOT NULL,
  hotel_name text NOT NULL, organization_id uuid NOT NULL REFERENCES organizations(id),
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY, hotel text NOT NULL, organization_slug text NOT NULL,
  room_number text NOT NULL, status text
);
CREATE TABLE public.gozsdu_housekeeping_room_registry (
  room_id uuid PRIMARY KEY REFERENCES rooms(id), pms_room_name text NOT NULL,
  service_status text NOT NULL
);
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department text NOT NULL,
  source text NOT NULL, source_room_id uuid, room_number text,
  description text, created_by uuid, organization_slug text, hotel text, title text,
  status text DEFAULT 'open'
);

INSERT INTO organizations(id,slug) VALUES
 ('00000000-0000-0000-0000-000000000010','rdhotels'),
 ('00000000-0000-0000-0000-000000000020','other-tenant');
INSERT INTO profiles(id,organization_slug) VALUES
 ('00000000-0000-0000-0000-000000000001','rdhotels');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
INSERT INTO hotel_configurations(hotel_id,hotel_name,organization_id) VALUES
 ('gozsdu-court','Gozsdu Court Budapest','00000000-0000-0000-0000-000000000010'),
 ('hotel-memories','Hotel Memories Budapest','00000000-0000-0000-0000-000000000010'),
 ('other-hotel','Other Hotel','00000000-0000-0000-0000-000000000020');
INSERT INTO rooms(id,hotel,organization_slug,room_number,status) VALUES
 ('00000000-0000-0000-0000-000000000101','gozsdu-court','rdhotels','110','dirty'),
 ('00000000-0000-0000-0000-000000000102','gozsdu-court','rdhotels','408','clean'),
 ('00000000-0000-0000-0000-000000000103','gozsdu-court','rdhotels','500','dirty'),
 ('00000000-0000-0000-0000-000000000104','hotel-memories','rdhotels','201','dirty'),
 ('00000000-0000-0000-0000-000000000105','hotel-memories','rdhotels','202','out_of_order'),
 ('00000000-0000-0000-0000-000000000106','other-hotel','other-tenant','101','dirty');
INSERT INTO gozsdu_housekeeping_room_registry(room_id,pms_room_name,service_status) VALUES
 ('00000000-0000-0000-0000-000000000101','1B-110','operating'),
 ('00000000-0000-0000-0000-000000000102','1BBALC-408','unavailable'),
 ('00000000-0000-0000-0000-000000000103','1B/500','non_guest');
