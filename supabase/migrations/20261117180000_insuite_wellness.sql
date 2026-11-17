-- In-Suite wellness: bookable jacuzzi and sauna slots.
--
-- One shared calendar for every channel: the guest's In-Suite page in the
-- room, the website booking engine (manage link and e-mails) and reception.
-- Bookings are instant, no approval step. Two bookings can never overlap:
-- every booking locks its resource row, re-checks the slot, and an exclusion
-- constraint rejects any overlap that could still slip through.
--
-- Defaults follow the hotel's rules: 60-minute slots, at most 2 guests, free
-- for hotel guests, one booking per room per day. Top managers change these
-- per resource. Resources start switched off unless stated otherwise.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ---------------------------------------------------------------- tables
CREATE TABLE IF NOT EXISTS public.insuite_wellness_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('jacuzzi', 'sauna')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 600),
  image_url text CHECK (image_url IS NULL OR image_url ~ '^https://'),
  slot_minutes integer NOT NULL DEFAULT 60 CHECK (slot_minutes BETWEEN 15 AND 240),
  max_guests integer NOT NULL DEFAULT 2 CHECK (max_guests BETWEEN 1 AND 8),
  opens_at time NOT NULL DEFAULT '09:00',
  closes_at time NOT NULL DEFAULT '21:00',
  weekdays smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}'
    CHECK (weekdays <@ '{1,2,3,4,5,6,7}'::smallint[] AND cardinality(weekdays) >= 1),
  max_per_day integer NOT NULL DEFAULT 1 CHECK (max_per_day BETWEEN 1 AND 12),
  price numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0 AND price <= 1000000),
  currency text NOT NULL DEFAULT 'HUF' CHECK (currency ~ '^[A-Z]{3}$'),
  is_active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT insuite_wellness_hours CHECK (closes_at > opens_at),
  CONSTRAINT insuite_wellness_one_per_kind UNIQUE (hotel_id, kind)
);

CREATE TABLE IF NOT EXISTS public.insuite_wellness_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  resource_id uuid NOT NULL REFERENCES public.insuite_wellness_resources(id) ON DELETE RESTRICT,
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  guest_name text NOT NULL CHECK (length(btrim(guest_name)) BETWEEN 1 AND 160),
  -- Only used to send the guest a ticket. Never shown on guest-facing pages.
  guest_email text CHECK (guest_email IS NULL OR guest_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 8),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  slot tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'completed', 'cancelled', 'no_show')),
  source text NOT NULL CHECK (source IN ('insuite', 'booking_engine', 'reception')),
  ticket_code text NOT NULL UNIQUE,
  client_request_id uuid,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 400),
  created_by uuid,
  key_handed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insuite_wellness_booking_times CHECK (ends_at > starts_at),
  -- The guarantee: never two live bookings of one resource at the same time.
  CONSTRAINT insuite_wellness_no_overlap EXCLUDE USING gist (resource_id WITH =, slot WITH &&)
    WHERE (status IN ('booked', 'completed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS insuite_wellness_bookings_client_request
  ON public.insuite_wellness_bookings (resource_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS insuite_wellness_bookings_hotel_time
  ON public.insuite_wellness_bookings (hotel_id, starts_at);
CREATE INDEX IF NOT EXISTS insuite_wellness_bookings_reservation
  ON public.insuite_wellness_bookings (reservation_id) WHERE reservation_id IS NOT NULL;

-- Who reception notifications go to, and the hotel's taxi / transfer prices.
CREATE TABLE IF NOT EXISTS public.insuite_wellness_settings (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  notification_emails text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(notification_emails) <= 10),
  -- [{"label": "Airport → hotel", "price": 12000, "currency": "HUF", "note": "up to 3 people"}]
  transfer_prices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transfer_prices) = 'array'),
  transfer_source text CHECK (transfer_source IS NULL OR length(transfer_source) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- ---------------------------------------------------------------- access
-- Every staff member of the hotel can see the wellness calendar (reception,
-- housekeeping, managers). All writes go through the service-role functions
-- below, called by the In-Suite and booking-engine edge functions after they
-- have checked who is asking.
ALTER TABLE public.insuite_wellness_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insuite_wellness_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insuite_wellness_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hotel staff read wellness resources" ON public.insuite_wellness_resources;
CREATE POLICY "Hotel staff read wellness resources" ON public.insuite_wellness_resources
  FOR SELECT TO authenticated USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
DROP POLICY IF EXISTS "Hotel staff read wellness bookings" ON public.insuite_wellness_bookings;
CREATE POLICY "Hotel staff read wellness bookings" ON public.insuite_wellness_bookings
  FOR SELECT TO authenticated USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
DROP POLICY IF EXISTS "Hotel staff read wellness settings" ON public.insuite_wellness_settings;
CREATE POLICY "Hotel staff read wellness settings" ON public.insuite_wellness_settings
  FOR SELECT TO authenticated USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));

REVOKE ALL ON public.insuite_wellness_resources, public.insuite_wellness_bookings, public.insuite_wellness_settings
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.insuite_wellness_resources, public.insuite_wellness_bookings, public.insuite_wellness_settings
  TO authenticated;
GRANT ALL ON public.insuite_wellness_resources, public.insuite_wellness_bookings, public.insuite_wellness_settings
  TO service_role;

-- ---------------------------------------------------------------- slots
-- The calendar for a hotel: every resource, every day in the range, every
-- slot with free / booked / mine / past. Guests (no _staff) only see whether
-- a slot is taken, plus details of their own bookings; staff see who booked.
CREATE OR REPLACE FUNCTION public.insuite_wellness_slots(
  _hotel_id text, _from date, _to date,
  _reservation_id uuid DEFAULT NULL, _staff boolean DEFAULT false, _include_inactive boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_to date;
  r public.insuite_wellness_resources%ROWTYPE;
  v_days jsonb;
  v_out jsonb := '[]'::jsonb;
  v_count integer;
BEGIN
  IF _hotel_id IS NULL OR _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATES');
  END IF;
  v_to := LEAST(_to, _from + 31);

  FOR r IN SELECT * FROM public.insuite_wellness_resources
            WHERE hotel_id = _hotel_id AND (is_active OR _include_inactive)
            ORDER BY sort_order, kind
  LOOP
    v_count := floor(extract(epoch FROM (r.closes_at - r.opens_at)) / 60 / r.slot_minutes)::integer;
    SELECT COALESCE(jsonb_agg(day_json ORDER BY day_date), '[]'::jsonb) INTO v_days
      FROM (
        SELECT d.day_date,
               jsonb_build_object(
                 'date', d.day_date,
                 'open', extract(isodow FROM d.day_date)::smallint = ANY (r.weekdays),
                 'slots', CASE WHEN NOT (extract(isodow FROM d.day_date)::smallint = ANY (r.weekdays)) THEN '[]'::jsonb ELSE COALESCE((
                   SELECT jsonb_agg(
                            jsonb_build_object(
                              'starts_at', s.starts_at,
                              'ends_at', s.ends_at,
                              'status', CASE
                                WHEN b.id IS NOT NULL AND _reservation_id IS NOT NULL AND b.reservation_id = _reservation_id THEN 'mine'
                                WHEN b.id IS NOT NULL THEN 'booked'
                                WHEN s.starts_at < now() - interval '15 minutes' THEN 'past'
                                ELSE 'free' END)
                            || CASE
                                 WHEN b.id IS NOT NULL AND _staff THEN jsonb_build_object('booking', jsonb_build_object(
                                   'id', b.id, 'guest_name', b.guest_name, 'room_number', rm.room_number,
                                   'reservation_id', b.reservation_id, 'party_size', b.party_size,
                                   'ticket_code', b.ticket_code, 'source', b.source, 'status', b.status,
                                   'key_handed_at', b.key_handed_at, 'notes', b.notes,
                                   'starts_at', b.starts_at, 'ends_at', b.ends_at, 'created_at', b.created_at))
                                 WHEN b.id IS NOT NULL AND _reservation_id IS NOT NULL AND b.reservation_id = _reservation_id
                                   THEN jsonb_build_object('booking', jsonb_build_object(
                                     'id', b.id, 'party_size', b.party_size, 'ticket_code', b.ticket_code,
                                     'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at))
                                 ELSE '{}'::jsonb END
                            ORDER BY s.starts_at)
                     FROM (
                       SELECT ((d.day_date + r.opens_at) + make_interval(mins => g * r.slot_minutes)) AT TIME ZONE 'Europe/Budapest' AS starts_at,
                              ((d.day_date + r.opens_at) + make_interval(mins => (g + 1) * r.slot_minutes)) AT TIME ZONE 'Europe/Budapest' AS ends_at
                         FROM generate_series(0, GREATEST(v_count - 1, -1)) g
                     ) s
                     LEFT JOIN LATERAL (
                       SELECT bk.* FROM public.insuite_wellness_bookings bk
                        WHERE bk.resource_id = r.id AND bk.status IN ('booked', 'completed')
                          AND bk.slot && tstzrange(s.starts_at, s.ends_at, '[)')
                        ORDER BY bk.starts_at LIMIT 1
                     ) b ON true
                     LEFT JOIN public.rooms rm ON rm.id = b.room_id
                 ), '[]'::jsonb) END
               ) AS day_json
          FROM (SELECT gs::date AS day_date FROM generate_series(_from, v_to, interval '1 day') gs) d
      ) days;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'name', r.name, 'description', r.description, 'image_url', r.image_url,
      'slot_minutes', r.slot_minutes, 'max_guests', r.max_guests,
      'opens_at', to_char(r.opens_at, 'HH24:MI'), 'closes_at', to_char(r.closes_at, 'HH24:MI'),
      'weekdays', to_jsonb(r.weekdays), 'max_per_day', r.max_per_day,
      'price', r.price, 'currency', r.currency, 'is_active', r.is_active, 'sort_order', r.sort_order,
      'days', v_days));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'from', _from, 'to', v_to, 'resources', v_out);
END;
$fn$;

-- ---------------------------------------------------------------- booking
-- Books one slot. Callers: insuite-api (guest in the room, reception) and
-- booking-engine (guest with a manage link). Raises a short code on refusal:
--   WELLNESS_UNAVAILABLE, INVALID_SOURCE, TOO_MANY_GUESTS, CLOSED, INVALID_SLOT,
--   SLOT_PASSED, TOO_FAR, STAY_NOT_ACTIVE, OUTSIDE_STAY, DAILY_LIMIT,
--   STAY_REQUIRED, GUEST_NAME_REQUIRED, SLOT_TAKEN
CREATE OR REPLACE FUNCTION public.insuite_wellness_book(
  _resource_id uuid,
  _starts_at timestamptz,
  _party_size integer,
  _source text,
  _reservation_id uuid DEFAULT NULL,
  _room_id uuid DEFAULT NULL,
  _guest_name text DEFAULT NULL,
  _guest_email text DEFAULT NULL,
  _created_by uuid DEFAULT NULL,
  _client_request_id uuid DEFAULT NULL,
  _notes text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.insuite_wellness_resources%ROWTYPE;
  v_res public.reservations%ROWTYPE;
  v_existing public.insuite_wellness_bookings%ROWTYPE;
  v_row public.insuite_wellness_bookings%ROWTYPE;
  v_local timestamp;
  v_date date;
  v_minute integer;
  v_open integer;
  v_close integer;
  v_end timestamptz;
  v_count integer;
  v_guest text;
  v_room uuid;
  v_email text;
  v_code text;
  v_attempt integer := 0;
  v_room_number text;
  v_hotel_name text;
BEGIN
  -- One booking at a time per resource: the lock is held until commit.
  SELECT * INTO r FROM public.insuite_wellness_resources WHERE id = _resource_id FOR UPDATE;
  IF NOT FOUND OR NOT r.is_active THEN RAISE EXCEPTION 'WELLNESS_UNAVAILABLE'; END IF;
  IF _source IS NULL OR _source NOT IN ('insuite', 'booking_engine', 'reception') THEN
    RAISE EXCEPTION 'INVALID_SOURCE';
  END IF;

  -- A retried request (same client id) returns the booking it already made.
  IF _client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.insuite_wellness_bookings
     WHERE resource_id = r.id AND client_request_id = _client_request_id;
    IF FOUND THEN
      RETURN to_jsonb(v_existing) - 'slot' || jsonb_build_object('repeated', true, 'resource_name', r.name, 'kind', r.kind);
    END IF;
  END IF;

  IF _party_size IS NULL OR _party_size < 1 OR _party_size > r.max_guests THEN
    RAISE EXCEPTION 'TOO_MANY_GUESTS';
  END IF;
  IF _starts_at IS NULL THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;

  v_local := _starts_at AT TIME ZONE 'Europe/Budapest';
  v_date := v_local::date;
  IF NOT (extract(isodow FROM v_date)::smallint = ANY (r.weekdays)) THEN RAISE EXCEPTION 'CLOSED'; END IF;
  v_minute := (extract(hour FROM v_local) * 60 + extract(minute FROM v_local))::integer;
  v_open := (extract(epoch FROM r.opens_at) / 60)::integer;
  v_close := (extract(epoch FROM r.closes_at) / 60)::integer;
  IF extract(second FROM v_local) <> 0 OR v_minute < v_open OR v_minute + r.slot_minutes > v_close
     OR (v_minute - v_open) % r.slot_minutes <> 0 THEN
    RAISE EXCEPTION 'INVALID_SLOT';
  END IF;
  -- The current slot can still be taken during its first 15 minutes.
  IF _starts_at < now() - interval '15 minutes' THEN RAISE EXCEPTION 'SLOT_PASSED'; END IF;
  IF _starts_at > now() + interval '400 days' THEN RAISE EXCEPTION 'TOO_FAR'; END IF;
  v_end := _starts_at + make_interval(mins => r.slot_minutes);

  v_email := NULLIF(lower(btrim(COALESCE(_guest_email, ''))), '');
  IF v_email IS NOT NULL AND v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN v_email := NULL; END IF;

  IF _reservation_id IS NOT NULL THEN
    SELECT * INTO v_res FROM public.reservations WHERE id = _reservation_id AND hotel_id = r.hotel_id;
    IF NOT FOUND OR v_res.status::text NOT IN ('pending', 'confirmed', 'checked_in') THEN
      RAISE EXCEPTION 'STAY_NOT_ACTIVE';
    END IF;
    IF v_date < v_res.check_in_date OR v_date > v_res.check_out_date THEN RAISE EXCEPTION 'OUTSIDE_STAY'; END IF;
    SELECT count(*) INTO v_count FROM public.insuite_wellness_bookings
     WHERE reservation_id = v_res.id AND resource_id = r.id AND status IN ('booked', 'completed')
       AND (starts_at AT TIME ZONE 'Europe/Budapest')::date = v_date;
    IF v_count >= r.max_per_day THEN RAISE EXCEPTION 'DAILY_LIMIT'; END IF;
    v_guest := COALESCE(NULLIF(btrim(COALESCE(_guest_name, '')), ''),
                        NULLIF(btrim(COALESCE(v_res.pms_guest_name, '')), ''),
                        (SELECT NULLIF(btrim(g.first_name || ' ' || g.last_name), '') FROM public.guests g WHERE g.id = v_res.guest_id),
                        'Hotel guest');
    v_room := COALESCE(_room_id, v_res.room_id);
  ELSE
    IF _source <> 'reception' THEN RAISE EXCEPTION 'STAY_REQUIRED'; END IF;
    v_guest := NULLIF(btrim(COALESCE(_guest_name, '')), '');
    IF v_guest IS NULL THEN RAISE EXCEPTION 'GUEST_NAME_REQUIRED'; END IF;
    v_room := _room_id;
  END IF;

  -- Clean refusal for the common case; the exclusion constraint is the backstop.
  IF EXISTS (SELECT 1 FROM public.insuite_wellness_bookings
              WHERE resource_id = r.id AND status IN ('booked', 'completed')
                AND slot && tstzrange(_starts_at, v_end, '[)')) THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    v_code := CASE r.kind WHEN 'jacuzzi' THEN 'JZ' WHEN 'sauna' THEN 'SA' ELSE 'WL' END
              || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    BEGIN
      INSERT INTO public.insuite_wellness_bookings (
        organization_slug, hotel_id, resource_id, reservation_id, room_id, guest_name, guest_email,
        party_size, starts_at, ends_at, source, ticket_code, client_request_id, notes, created_by)
      VALUES (
        r.organization_slug, r.hotel_id, r.id, _reservation_id, v_room, left(v_guest, 160), v_email,
        _party_size, _starts_at, v_end, _source, v_code, _client_request_id,
        left(COALESCE(_notes, ''), 400), _created_by)
      RETURNING * INTO v_row;
      EXIT;
    EXCEPTION
      WHEN exclusion_violation THEN RAISE EXCEPTION 'SLOT_TAKEN';
      WHEN unique_violation THEN
        IF _client_request_id IS NOT NULL THEN
          SELECT * INTO v_existing FROM public.insuite_wellness_bookings
           WHERE resource_id = r.id AND client_request_id = _client_request_id;
          IF FOUND THEN
            RETURN to_jsonb(v_existing) - 'slot' || jsonb_build_object('repeated', true, 'resource_name', r.name, 'kind', r.kind);
          END IF;
        END IF;
        IF v_attempt >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  SELECT rm.room_number INTO v_room_number FROM public.rooms rm WHERE rm.id = v_row.room_id;
  SELECT hc.hotel_name INTO v_hotel_name FROM public.hotel_configurations hc WHERE hc.hotel_id = r.hotel_id;

  RETURN to_jsonb(v_row) - 'slot' || jsonb_build_object(
    'repeated', false, 'resource_name', r.name, 'kind', r.kind,
    'room_number', v_room_number, 'hotel_name', COALESCE(v_hotel_name, r.hotel_id),
    'price', r.price, 'currency', r.currency);
END;
$fn$;

-- ---------------------------------------------------------------- changes
-- Guest channel (_reservation_id given): only "cancel", only their own
-- booking, only before it starts. Staff: cancel, complete, no_show, key_handed.
CREATE OR REPLACE FUNCTION public.insuite_wellness_change(
  _booking_id uuid, _hotel_id text, _action text,
  _actor uuid DEFAULT NULL, _reservation_id uuid DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  b public.insuite_wellness_bookings%ROWTYPE;
  r public.insuite_wellness_resources%ROWTYPE;
BEGIN
  SELECT * INTO b FROM public.insuite_wellness_bookings
   WHERE id = _booking_id AND hotel_id = _hotel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF _reservation_id IS NOT NULL THEN
    IF b.reservation_id IS DISTINCT FROM _reservation_id THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF _action <> 'cancel' THEN RAISE EXCEPTION 'INVALID_ACTION'; END IF;
    IF b.status <> 'booked' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    IF b.starts_at <= now() THEN RAISE EXCEPTION 'TOO_LATE'; END IF;
  END IF;

  IF _action = 'cancel' THEN
    IF b.status <> 'booked' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    UPDATE public.insuite_wellness_bookings
       SET status = 'cancelled', cancelled_at = now(), cancelled_by = _actor,
           cancel_reason = left(NULLIF(btrim(COALESCE(_reason, '')), ''), 300), updated_at = now()
     WHERE id = b.id RETURNING * INTO b;
  ELSIF _action = 'complete' THEN
    IF b.status <> 'booked' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    UPDATE public.insuite_wellness_bookings SET status = 'completed', updated_at = now()
     WHERE id = b.id RETURNING * INTO b;
  ELSIF _action = 'no_show' THEN
    IF b.status <> 'booked' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    IF b.starts_at > now() THEN RAISE EXCEPTION 'TOO_EARLY'; END IF;
    UPDATE public.insuite_wellness_bookings SET status = 'no_show', updated_at = now()
     WHERE id = b.id RETURNING * INTO b;
  ELSIF _action = 'key_handed' THEN
    IF b.status <> 'booked' THEN RAISE EXCEPTION 'INVALID_TRANSITION'; END IF;
    UPDATE public.insuite_wellness_bookings SET key_handed_at = COALESCE(key_handed_at, now()), updated_at = now()
     WHERE id = b.id RETURNING * INTO b;
  ELSE
    RAISE EXCEPTION 'INVALID_ACTION';
  END IF;

  SELECT * INTO r FROM public.insuite_wellness_resources WHERE id = b.resource_id;
  RETURN to_jsonb(b) - 'slot' || jsonb_build_object(
    'resource_name', r.name, 'kind', r.kind,
    'room_number', (SELECT rm.room_number FROM public.rooms rm WHERE rm.id = b.room_id),
    'hotel_name', COALESCE((SELECT hc.hotel_name FROM public.hotel_configurations hc WHERE hc.hotel_id = b.hotel_id), b.hotel_id));
END;
$fn$;

-- Bookings of one or more stays (guest page and manage link show them all,
-- whichever channel made them).
CREATE OR REPLACE FUNCTION public.insuite_wellness_stay_bookings(_reservation_ids uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', b.id, 'resource_id', b.resource_id, 'resource_name', r.name, 'kind', r.kind,
           'starts_at', b.starts_at, 'ends_at', b.ends_at, 'party_size', b.party_size,
           'status', b.status, 'ticket_code', b.ticket_code, 'source', b.source,
           'reservation_id', b.reservation_id, 'room_number', rm.room_number,
           'can_cancel', b.status = 'booked' AND b.starts_at > now())
         ORDER BY b.starts_at), '[]'::jsonb)
    FROM public.insuite_wellness_bookings b
    JOIN public.insuite_wellness_resources r ON r.id = b.resource_id
    LEFT JOIN public.rooms rm ON rm.id = b.room_id
   WHERE b.reservation_id = ANY (_reservation_ids) AND b.status IN ('booked', 'completed');
$fn$;

REVOKE ALL ON FUNCTION public.insuite_wellness_slots(text, date, date, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insuite_wellness_book(uuid, timestamptz, integer, text, uuid, uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insuite_wellness_change(uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.insuite_wellness_stay_bookings(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insuite_wellness_slots(text, date, date, uuid, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.insuite_wellness_book(uuid, timestamptz, integer, text, uuid, uuid, text, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.insuite_wellness_change(uuid, text, text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.insuite_wellness_stay_bookings(uuid[]) TO service_role;

-- ---------------------------------------------------------------- seed
-- Channex test property: switched on so the whole flow can be tested.
-- Hotel Memories Budapest (the hotel with the jacuzzi): created switched
-- off; a top manager checks the opening hours and switches them on.
INSERT INTO public.insuite_wellness_resources (organization_slug, hotel_id, kind, name, description, is_active, sort_order)
SELECT o.slug, h.hotel_id, v.kind, v.name, v.description, h.hotel_id = 'channex-test-property', v.sort_order
  FROM public.hotel_configurations h
  JOIN public.organizations o ON o.id = h.organization_id
 CROSS JOIN (VALUES
   ('jacuzzi', 'Jacuzzi', 'Private jacuzzi for up to 2 guests. Free for hotel guests. Collect the key at reception.', 1),
   ('sauna', 'Sauna', 'Private sauna for up to 2 guests. Free for hotel guests. Collect the key at reception.', 2)
 ) AS v(kind, name, description, sort_order)
 WHERE h.hotel_id IN ('channex-test-property', 'memories-budapest')
ON CONFLICT (hotel_id, kind) DO NOTHING;
