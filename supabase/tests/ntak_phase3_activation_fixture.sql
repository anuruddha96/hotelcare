-- Disposable PostgreSQL 16 fixture ONLY. Never apply to an actual hotel.
-- Load supabase/tests/ntak_fixture.sql before this file.
ALTER TABLE public.rooms
  ADD COLUMN room_capacity integer DEFAULT 4,
  ADD COLUMN guest_count integer DEFAULT 0,
  ADD COLUMN is_checkout_room boolean DEFAULT false,
  ADD COLUMN checkout_time timestamptz,
  ADD COLUMN updated_at timestamptz DEFAULT now();

ALTER TABLE public.reservations
  ADD COLUMN actual_check_in timestamptz,
  ADD COLUMN actual_check_out timestamptz,
  ADD COLUMN balance_due numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(
  _actor uuid,_hotel_id text,_organization_slug text
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.hotel_access a
    JOIN public.profiles p ON p.id=a.user_id
    WHERE a.user_id=_actor AND a.hotel_id=_hotel_id
      AND p.organization_slug=_organization_slug
  )
$$;
CREATE OR REPLACE FUNCTION public.pms_hotel_room_keys(_hotel_id text)
RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT CASE _hotel_id
    WHEN 'late-hotel' THEN 'Late Test Property'
    ELSE 'Test Property - HotelCare' END
$$;
CREATE OR REPLACE FUNCTION public.pms_ntak_guest_scope(_reservation_id uuid,_room_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.reservations r JOIN public.ntak_settings s
    ON r.hotel_id=s.hotel_id AND s.enabled
    WHERE r.id=_reservation_id)
$$;
CREATE OR REPLACE FUNCTION public.pms_room_has_conflict(
  _room uuid,_from date,_to date,_exclude uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.pms_assert_business_moment(
  _hotel text,_org text,_moment timestamptz
) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE OR REPLACE FUNCTION public.pms_set_business_moment(_moment timestamptz)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;

CREATE TABLE public.ntak_settings(
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  unit_scope text DEFAULT 'all',
  first_closure_date date
);
CREATE TABLE public.ntak_unit_profiles (
  hotel_id text,room_id uuid,active boolean DEFAULT true
);
CREATE TABLE public.ntak_room_type_units (
  hotel_id text,room_type_id uuid,active boolean DEFAULT true
);
CREATE TABLE public.reservation_guests(
  reservation_id uuid NOT NULL REFERENCES public.reservations(id),
  guest_id uuid NOT NULL REFERENCES public.guests(id),
  is_primary boolean NOT NULL DEFAULT false,
  stay_state text NOT NULL DEFAULT 'expected',
  arrived_at timestamptz,
  departed_at timestamptz,
  room_id uuid,
  PRIMARY KEY(reservation_id,guest_id)
);
CREATE TABLE public.ntak_event_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text,
  reservation_id uuid NOT NULL,
  kind text NOT NULL,
  room_id uuid,
  from_room_id uuid,
  is_correction boolean DEFAULT false,
  occurred_at timestamptz,
  guest_ids uuid[]
);
CREATE TABLE public.reservation_room_assignments (
  reservation_id uuid,room_id uuid,
  check_in_date date,check_out_date date,status text
);
CREATE TABLE public.reservation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid,hotel_id text,organization_slug text,
  event_type text,metadata jsonb,created_by uuid
);

CREATE TABLE public.viza_settings(
  hotel_id text PRIMARY KEY,organization_slug text,
  enabled boolean DEFAULT false,
  adatszolgaltatasi_azonosito text,
  last_error text,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.viza_guest_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text,
  organization_slug text,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id),
  guest_id uuid,
  erkezes_ideje timestamptz,
  tavozas_varhato_datuma date,
  tavozas_ideje timestamptz,
  arrival_state text NOT NULL DEFAULT 'queued',
  departure_state text,
  last_error text,
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX viza_guest_events_res_guest ON public.viza_guest_events
  (reservation_id,COALESCE(guest_id,'00000000-0000-0000-0000-000000000000'::uuid));

-- Fixture data test permission grants: all sensitive writers remain definer-only.
GRANT SELECT ON public.reservation_guests,public.viza_settings,
  public.viza_guest_events,public.ntak_event_queue,public.ntak_settings TO authenticated;
GRANT UPDATE ON public.reservations TO authenticated;

-- The VIZA status trigger exists in production from the earlier VIZA migration;
-- this disposable fixture installs it after the NEW migration replaces the body.
