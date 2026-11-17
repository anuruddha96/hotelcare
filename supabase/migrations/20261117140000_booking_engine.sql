-- HotelCare booking engine: direct bookings from the hotel's own website.
--
-- One connected platform: the engine reads exactly the rates, restrictions and
-- availability that HotelCare sends to Channex (pms_ari_rates,
-- pms_ari_availability, rate_plans), and writes ordinary reservations. The
-- existing reservation triggers then refresh availability, push the change to
-- Channex/OTAs and notify managers; reception, housekeeping and the guest
-- directory see website bookings like any other booking.
--
-- Only hotels where HotelCare is the PMS (pms_ari_native_hotel) can take
-- bookings. Previo hotels keep their current booking engine.

-- ---------------------------------------------------------------- room content
-- Guest-facing description of a room type. PMS-level data: the booking engine
-- uses it now; Channex room content and In-Suite can use it later.
CREATE TABLE IF NOT EXISTS public.room_type_profiles (
  room_type_id uuid PRIMARY KEY REFERENCES public.room_types(id) ON DELETE CASCADE,
  hotel_id text NOT NULL,
  max_adults smallint NOT NULL DEFAULT 2 CHECK (max_adults BETWEEN 1 AND 20),
  max_children smallint NOT NULL DEFAULT 0 CHECK (max_children BETWEEN 0 AND 20),
  max_occupancy smallint NOT NULL DEFAULT 2 CHECK (max_occupancy BETWEEN 1 AND 30),
  size_sqm numeric(6,1) CHECK (size_sqm IS NULL OR size_sqm > 0),
  bed_setup jsonb NOT NULL DEFAULT '{}'::jsonb,     -- {"en": "1 queen bed", "hu": "..."}
  description jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"en": "...", "hu": "..."}
  amenities text[] NOT NULL DEFAULT '{}',
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{"url": "...", "path": "..."}], first = cover
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
CREATE INDEX IF NOT EXISTS room_type_profiles_hotel_idx ON public.room_type_profiles (hotel_id);

-- hotel_id always comes from the room type, so access checks cannot be spoofed.
CREATE OR REPLACE FUNCTION public.room_type_profiles_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  SELECT rt.hotel_id INTO NEW.hotel_id FROM public.room_types rt WHERE rt.id = NEW.room_type_id;
  IF NEW.hotel_id IS NULL THEN RAISE EXCEPTION 'ROOM_TYPE_NOT_FOUND'; END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS tr_room_type_profiles_before_write ON public.room_type_profiles;
CREATE TRIGGER tr_room_type_profiles_before_write
  BEFORE INSERT OR UPDATE ON public.room_type_profiles
  FOR EACH ROW EXECUTE FUNCTION public.room_type_profiles_before_write();

-- ---------------------------------------------------------------- engine config
CREATE TABLE IF NOT EXISTS public.booking_engines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Public identifier used in links and the website embed. Not a secret.
  public_id text NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  hotel_id text NOT NULL UNIQUE,
  organization_slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  display_name text,
  logo_url text,
  theme jsonb NOT NULL DEFAULT '{"primary": "#8a6a3d", "style": "classic"}'::jsonb,
  languages text[] NOT NULL DEFAULT ARRAY['en', 'hu'],
  default_language text NOT NULL DEFAULT 'en',
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,          -- {email, phone, address, website}
  notification_emails text[] NOT NULL DEFAULT '{}',
  -- {check_in_from, check_out_until, free_cancellation_days, terms_url, privacy_url,
  --  city_tax_note: {lang: text}, extra_note: {lang: text}}
  policies jsonb NOT NULL DEFAULT '{"check_in_from": "14:00", "check_out_until": "11:00", "free_cancellation_days": 2}'::jsonb,
  -- {min_lead_days, max_advance_days, max_nights, max_rooms, same_day_cutoff}
  booking_window jsonb NOT NULL DEFAULT '{"min_lead_days": 0, "max_advance_days": 365, "max_nights": 30, "max_rooms": 4, "same_day_cutoff": "22:00"}'::jsonb,
  -- Per rate plan: {"<rate_plan_id>": {"enabled": true, "refundable": true, "free_cancellation_days": 2, "names": {lang: text}}}
  rate_plans jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT booking_engines_languages_chk CHECK (languages <@ ARRAY['en','hu','de','es','it','fr'] AND cardinality(languages) >= 1),
  CONSTRAINT booking_engines_default_language_chk CHECK (default_language = ANY (languages))
);

CREATE OR REPLACE FUNCTION public.booking_engines_before_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The public id and hotel never change once websites embed the engine.
    NEW.public_id := OLD.public_id;
    NEW.hotel_id := OLD.hotel_id;
    NEW.organization_slug := OLD.organization_slug;
  ELSE
    SELECT o.slug INTO NEW.organization_slug
      FROM public.hotel_configurations hc JOIN public.organizations o ON o.id = hc.organization_id
     WHERE hc.hotel_id = NEW.hotel_id LIMIT 1;
    IF NEW.organization_slug IS NULL THEN RAISE EXCEPTION 'HOTEL_NOT_FOUND'; END IF;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS tr_booking_engines_before_write ON public.booking_engines;
CREATE TRIGGER tr_booking_engines_before_write
  BEFORE INSERT OR UPDATE ON public.booking_engines
  FOR EACH ROW EXECUTE FUNCTION public.booking_engines_before_write();

-- ---------------------------------------------------------------- website bookings
-- One row per website checkout; each booked room is an ordinary reservation.
CREATE TABLE IF NOT EXISTS public.booking_engine_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id uuid NOT NULL REFERENCES public.booking_engines(id) ON DELETE RESTRICT,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  reference text NOT NULL UNIQUE,
  manage_token_hash text NOT NULL,            -- sha-256 of the guest's manage link token; the token itself is never stored
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  guest_email text NOT NULL,
  guest_name text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  rooms jsonb NOT NULL,                       -- [{reservation_id, reservation_number, room_type_id, rate_plan_id, adults, children, total}]
  total_amount numeric(12,2) NOT NULL,
  currency text NOT NULL,
  free_cancellation_until timestamptz,        -- NULL: non-refundable
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,  -- utm_*, gclid, fbclid, referrer host
  consent jsonb NOT NULL DEFAULT '{}'::jsonb,
  guest_email_status text,
  hotel_email_status text,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS booking_engine_bookings_hotel_idx ON public.booking_engine_bookings (hotel_id, created_at DESC);

-- ---------------------------------------------------------------- rate limits
CREATE TABLE IF NOT EXISTS public.booking_engine_rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE OR REPLACE FUNCTION public.booking_engine_hit(p_bucket text, p_window_seconds integer, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  w timestamptz := to_timestamp(floor(extract(epoch FROM now()) / GREATEST(p_window_seconds, 1)) * GREATEST(p_window_seconds, 1));
  n integer;
BEGIN
  INSERT INTO public.booking_engine_rate_limits AS l (bucket, window_start, hits) VALUES (p_bucket, w, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = l.hits + 1
  RETURNING hits INTO n;
  RETURN n <= p_limit;
END;
$fn$;

-- ---------------------------------------------------------------- access
CREATE OR REPLACE FUNCTION public.booking_engine_can_manage(_hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT auth.uid() IS NOT NULL
     AND public.can_access_pms_hotel(auth.uid(), _hotel_id, NULL)
     AND (public.is_super_admin(auth.uid())
          OR public.get_user_role(auth.uid())::text = ANY (ARRAY['admin', 'top_management', 'top_management_manager', 'manager']));
$fn$;

ALTER TABLE public.room_type_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_engines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_engine_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_engine_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hotel staff read room profiles" ON public.room_type_profiles;
CREATE POLICY "Hotel staff read room profiles" ON public.room_type_profiles
  FOR SELECT TO authenticated USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
DROP POLICY IF EXISTS "Managers write room profiles" ON public.room_type_profiles;
CREATE POLICY "Managers write room profiles" ON public.room_type_profiles
  FOR ALL TO authenticated
  USING (public.booking_engine_can_manage(hotel_id))
  WITH CHECK (public.booking_engine_can_manage((SELECT rt.hotel_id FROM public.room_types rt WHERE rt.id = room_type_id)));

DROP POLICY IF EXISTS "Hotel staff read booking engine" ON public.booking_engines;
CREATE POLICY "Hotel staff read booking engine" ON public.booking_engines
  FOR SELECT TO authenticated USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
DROP POLICY IF EXISTS "Managers create booking engine for HotelCare-PMS hotels" ON public.booking_engines;
CREATE POLICY "Managers create booking engine for HotelCare-PMS hotels" ON public.booking_engines
  FOR INSERT TO authenticated
  WITH CHECK (public.booking_engine_can_manage(hotel_id) AND public.pms_ari_native_hotel(hotel_id));
DROP POLICY IF EXISTS "Managers update booking engine" ON public.booking_engines;
CREATE POLICY "Managers update booking engine" ON public.booking_engines
  FOR UPDATE TO authenticated
  USING (public.booking_engine_can_manage(hotel_id))
  WITH CHECK (public.booking_engine_can_manage(hotel_id));

DROP POLICY IF EXISTS "Hotel staff read website bookings" ON public.booking_engine_bookings;
CREATE POLICY "Hotel staff read website bookings" ON public.booking_engine_bookings
  FOR SELECT TO authenticated USING (public.can_access_pms_hotel(auth.uid(), hotel_id, NULL));
-- booking_engine_rate_limits: no policies (service role only).

-- ---------------------------------------------------------------- helpers
-- Hotel-local "today" and the booking window check shared by search and booking.
CREATE OR REPLACE FUNCTION public.booking_engine_window_error(p_engine public.booking_engines, p_check_in date, p_check_out date)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  w jsonb := COALESCE(p_engine.booking_window, '{}'::jsonb);
  tz text := COALESCE((SELECT c.timezone FROM public.channex_connections c WHERE c.hotel_id = p_engine.hotel_id LIMIT 1), 'Europe/Budapest');
  today date := (now() AT TIME ZONE tz)::date;
  nights integer := p_check_out - p_check_in;
BEGIN
  IF p_check_in IS NULL OR p_check_out IS NULL OR nights < 1 THEN RETURN 'INVALID_DATES'; END IF;
  IF p_check_in < today + GREATEST(COALESCE((w->>'min_lead_days')::int, 0), 0) THEN RETURN 'TOO_SOON'; END IF;
  -- Inventory and rates are kept about 500 days ahead (the Channex horizon).
  IF p_check_in > today + LEAST(COALESCE((w->>'max_advance_days')::int, 365), 490) THEN RETURN 'TOO_FAR'; END IF;
  IF nights > LEAST(COALESCE((w->>'max_nights')::int, 30), 60) THEN RETURN 'TOO_LONG'; END IF;
  IF p_check_in = today
     AND (now() AT TIME ZONE tz)::time > COALESCE(NULLIF(w->>'same_day_cutoff', '')::time, time '22:00') THEN
    RETURN 'TOO_SOON';
  END IF;
  RETURN NULL;
END;
$fn$;

-- Every sellable (room type, rate plan) for a stay with price and the first
-- restriction that blocks it. Same rules and defaults as the Channex full sync
-- (channex_full_sync_rates), so the website never sells what the OTAs cannot.
CREATE OR REPLACE FUNCTION public.booking_engine_offers(p_engine_id uuid, p_check_in date, p_check_out date)
RETURNS TABLE (room_type_id uuid, rate_plan_id uuid, available integer, nights integer, total numeric,
               currency text, nightly jsonb, min_stay integer, max_stay integer, blocked text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH e AS (
    SELECT be.id, be.hotel_id, be.rate_plans FROM public.booking_engines be WHERE be.id = p_engine_id
  ),
  stay AS (
    SELECT d::date AS night FROM generate_series(p_check_in, p_check_out - 1, interval '1 day') d
  ),
  plans AS (
    SELECT rp.id AS plan_id, rp.room_type_id AS type_id,
           upper(COALESCE(rp.currency, (SELECT c.currency FROM public.channex_connections c WHERE c.hotel_id = e.hotel_id LIMIT 1), 'EUR')) AS cur,
           rp.base_rate,
           GREATEST(COALESCE(rp.min_stay, 1), 1) AS rp_min,
           COALESCE(rp.max_stay, 0) AS rp_max
      FROM e
      JOIN public.rate_plans rp ON rp.hotel_id = e.hotel_id AND COALESCE(rp.is_active, true)
      JOIN public.room_types rt ON rt.id = rp.room_type_id AND rt.hotel_id = e.hotel_id
                               AND COALESCE(rt.is_sellable, true) AND COALESCE(rt.counts_toward_inventory, true)
     WHERE COALESCE((e.rate_plans -> rp.id::text ->> 'enabled')::boolean, true)
  ),
  per_night AS (
    SELECT p.plan_id, p.type_id, s.night,
           COALESCE(r.rate, p.base_rate) AS rate,
           COALESCE(r.min_stay_through, r.min_stay_arrival, p.rp_min) AS min_through,
           COALESCE(r.stop_sell, false) AS stop_sell,
           COALESCE(a.availability, 0) AS avail
      FROM plans p
      CROSS JOIN stay s
      LEFT JOIN public.pms_ari_rates r ON r.rate_plan_id = p.plan_id AND r.date = s.night
      LEFT JOIN public.pms_ari_availability a ON a.room_type_id = p.type_id AND a.date = s.night
  ),
  arrival AS (
    SELECT p.plan_id,
           COALESCE(r.min_stay_arrival, p.rp_min) AS min_arrival,
           COALESCE(r.max_stay, p.rp_max) AS max_stay,
           COALESCE(r.closed_to_arrival, false) AS cta
      FROM plans p
      LEFT JOIN public.pms_ari_rates r ON r.rate_plan_id = p.plan_id AND r.date = p_check_in
  ),
  departure AS (
    SELECT p.plan_id, COALESCE(r.closed_to_departure, false) AS ctd
      FROM plans p
      LEFT JOIN public.pms_ari_rates r ON r.rate_plan_id = p.plan_id AND r.date = p_check_out
  ),
  agg AS (
    SELECT n.plan_id, n.type_id,
           count(*)::int AS nights,
           min(n.avail)::int AS available,
           sum(n.rate) AS total,
           bool_or(n.rate IS NULL OR n.rate <= 0) AS no_rate,
           bool_or(n.stop_sell) AS stop_sell,
           max(n.min_through)::int AS min_through,
           jsonb_agg(jsonb_build_object('date', n.night, 'rate', n.rate) ORDER BY n.night) AS nightly
      FROM per_night n
     GROUP BY n.plan_id, n.type_id
  )
  SELECT g.type_id, g.plan_id, g.available, g.nights, round(g.total, 2), p.cur, g.nightly,
         GREATEST(a.min_arrival, g.min_through)::int,
         NULLIF(a.max_stay, 0)::int,
         CASE
           WHEN g.no_rate THEN 'no_rate'
           WHEN g.stop_sell THEN 'stop_sell'
           WHEN a.cta THEN 'closed_to_arrival'
           WHEN d.ctd THEN 'closed_to_departure'
           WHEN g.nights < GREATEST(a.min_arrival, g.min_through) THEN 'min_stay'
           WHEN a.max_stay > 0 AND g.nights > a.max_stay THEN 'max_stay'
           WHEN g.available <= 0 THEN 'sold_out'
         END
    FROM agg g
    JOIN plans p ON p.plan_id = g.plan_id
    JOIN arrival a ON a.plan_id = g.plan_id
    JOIN departure d ON d.plan_id = g.plan_id;
$fn$;

-- ---------------------------------------------------------------- public reads
CREATE OR REPLACE FUNCTION public.booking_engine_public_config(p_public_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'engine', jsonb_build_object(
      'id', be.public_id,
      'enabled', be.enabled AND public.pms_ari_native_hotel(be.hotel_id),
      'name', COALESCE(NULLIF(trim(be.display_name), ''), hc.hotel_name, be.hotel_id),
      'logo_url', COALESCE(NULLIF(trim(be.logo_url), ''), hc.custom_logo_url),
      'theme', be.theme,
      'languages', to_jsonb(be.languages),
      'default_language', be.default_language,
      'contact', be.contact,
      'policies', be.policies,
      'booking_window', be.booking_window,
      'today', (now() AT TIME ZONE COALESCE(c.timezone, 'Europe/Budapest'))::date,
      'currency', (SELECT upper(COALESCE(rp.currency, c.currency, 'EUR')) FROM public.rate_plans rp
                    WHERE rp.hotel_id = be.hotel_id AND COALESCE(rp.is_active, true)
                    ORDER BY rp.sort_order NULLS LAST, rp.created_at LIMIT 1)
    ),
    'room_types', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', rt.id,
               'name', rt.name,
               'names', COALESCE(rt.name_translations, '{}'::jsonb),
               'max_adults', COALESCE(pf.max_adults, 2),
               'max_children', COALESCE(pf.max_children, 0),
               'max_occupancy', COALESCE(pf.max_occupancy, 2),
               'size_sqm', pf.size_sqm,
               'beds', COALESCE(pf.bed_setup, '{}'::jsonb),
               'description', COALESCE(pf.description, '{}'::jsonb),
               'amenities', COALESCE(to_jsonb(pf.amenities), '[]'::jsonb),
               'photos', COALESCE(pf.photos, '[]'::jsonb),
               'rate_plans', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', rp.id,
                          'name', rp.name,
                          'names', COALESCE(be.rate_plans -> rp.id::text -> 'names', '{}'::jsonb),
                          'meal_plan', rp.meal_plan,
                          'refundable', COALESCE((be.rate_plans -> rp.id::text ->> 'refundable')::boolean, true),
                          'free_cancellation_days', COALESCE((be.rate_plans -> rp.id::text ->> 'free_cancellation_days')::int,
                                                             (be.policies ->> 'free_cancellation_days')::int, 1)
                        ) ORDER BY rp.sort_order NULLS LAST, rp.name)
                   FROM public.rate_plans rp
                  WHERE rp.room_type_id = rt.id AND rp.hotel_id = be.hotel_id AND COALESCE(rp.is_active, true)
                    AND COALESCE((be.rate_plans -> rp.id::text ->> 'enabled')::boolean, true)
               ), '[]'::jsonb)
             ) ORDER BY rt.sort_order NULLS LAST, rt.name)
        FROM public.room_types rt
        LEFT JOIN public.room_type_profiles pf ON pf.room_type_id = rt.id
       WHERE rt.hotel_id = be.hotel_id AND COALESCE(rt.is_sellable, true) AND COALESCE(rt.counts_toward_inventory, true)
    ), '[]'::jsonb)
  )
  FROM public.booking_engines be
  LEFT JOIN public.hotel_configurations hc ON hc.hotel_id = be.hotel_id
  LEFT JOIN LATERAL (SELECT cc.timezone, cc.currency FROM public.channex_connections cc WHERE cc.hotel_id = be.hotel_id LIMIT 1) c ON true
  WHERE be.public_id = p_public_id;
$fn$;

-- Lowest nightly price and availability per day, for the date picker.
CREATE OR REPLACE FUNCTION public.booking_engine_calendar(p_public_id text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  e public.booking_engines%ROWTYPE;
  v_to date;
BEGIN
  SELECT * INTO e FROM public.booking_engines WHERE public_id = p_public_id;
  IF NOT FOUND OR NOT public.pms_ari_native_hotel(e.hotel_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ENGINE_UNAVAILABLE');
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_DATES');
  END IF;
  v_to := LEAST(p_to, p_from + 92);
  RETURN jsonb_build_object('ok', true, 'days', COALESCE((
    WITH plans AS (
      SELECT rp.id AS plan_id, rp.room_type_id AS type_id, rp.base_rate, GREATEST(COALESCE(rp.min_stay, 1), 1) AS rp_min
        FROM public.rate_plans rp
        JOIN public.room_types rt ON rt.id = rp.room_type_id AND rt.hotel_id = e.hotel_id
                                 AND COALESCE(rt.is_sellable, true) AND COALESCE(rt.counts_toward_inventory, true)
       WHERE rp.hotel_id = e.hotel_id AND COALESCE(rp.is_active, true)
         AND COALESCE((e.rate_plans -> rp.id::text ->> 'enabled')::boolean, true)
    ),
    x AS (
      SELECT d::date AS day, COALESCE(r.rate, p.base_rate) AS rate,
             COALESCE(r.stop_sell, false) AS ss, COALESCE(r.closed_to_arrival, false) AS cta,
             COALESCE(r.min_stay_arrival, p.rp_min) AS min_arr, COALESCE(a.availability, 0) AS avail
        FROM generate_series(p_from, v_to, interval '1 day') d
        CROSS JOIN plans p
        LEFT JOIN public.pms_ari_rates r ON r.rate_plan_id = p.plan_id AND r.date = d::date
        LEFT JOIN public.pms_ari_availability a ON a.room_type_id = p.type_id AND a.date = d::date
    ),
    days AS (
      SELECT day,
             bool_or(avail > 0 AND NOT ss AND rate > 0) AS open,
             min(rate) FILTER (WHERE avail > 0 AND NOT ss AND rate > 0) AS from_price,
             COALESCE(bool_and(cta) FILTER (WHERE avail > 0 AND NOT ss AND rate > 0), false) AS cta,
             min(min_arr) FILTER (WHERE avail > 0 AND NOT ss AND rate > 0 AND NOT cta) AS min_stay
        FROM x GROUP BY day
    )
    SELECT jsonb_agg(jsonb_build_object('date', day, 'open', open, 'from', round(from_price, 2),
                                        'cta', cta, 'min_stay', min_stay) ORDER BY day)
      FROM days
  ), '[]'::jsonb));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.booking_engine_search(p_public_id text, p_check_in date, p_check_out date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  e public.booking_engines%ROWTYPE;
  v_err text;
BEGIN
  SELECT * INTO e FROM public.booking_engines WHERE public_id = p_public_id;
  IF NOT FOUND OR NOT public.pms_ari_native_hotel(e.hotel_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ENGINE_UNAVAILABLE');
  END IF;
  v_err := public.booking_engine_window_error(e, p_check_in, p_check_out);
  IF v_err IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', v_err); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'nights', p_check_out - p_check_in,
    'offers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'room_type_id', o.room_type_id, 'rate_plan_id', o.rate_plan_id,
               'available', GREATEST(o.available, 0), 'total', o.total, 'currency', o.currency,
               'nightly', o.nightly, 'min_stay', o.min_stay, 'max_stay', o.max_stay, 'blocked', o.blocked))
        FROM public.booking_engine_offers(e.id, p_check_in, p_check_out) o
    ), '[]'::jsonb)
  );
END;
$fn$;

-- ---------------------------------------------------------------- booking
CREATE OR REPLACE FUNCTION public.booking_engine_create_booking(
  p_public_id text,
  p_check_in date,
  p_check_out date,
  p_rooms jsonb,          -- [{room_type_id, rate_plan_id, adults, children}]
  p_guest jsonb,          -- {first_name, last_name, email, phone, country, arrival_time, special_requests}
  p_language text,
  p_consent jsonb,        -- {terms: true, marketing: bool}
  p_attribution jsonb,
  p_token_hash text,
  p_ip_hash text,
  p_user_agent text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  e public.booking_engines%ROWTYPE;
  v_err text;
  v_nights integer := p_check_out - p_check_in;
  v_max_rooms integer;
  v_lang text := CASE WHEN p_language IN ('en','hu','de','es','it','fr') THEN p_language ELSE 'en' END;
  v_email text := lower(trim(COALESCE(p_guest->>'email', '')));
  v_first text := left(trim(COALESCE(p_guest->>'first_name', '')), 80);
  v_last text := left(trim(COALESCE(p_guest->>'last_name', '')), 80);
  v_phone text := NULLIF(left(trim(COALESCE(p_guest->>'phone', '')), 40), '');
  v_country text := NULLIF(upper(left(trim(COALESCE(p_guest->>'country', '')), 2)), '');
  v_arrival text := NULLIF(left(trim(COALESCE(p_guest->>'arrival_time', '')), 20), '');
  v_request text := NULLIF(left(trim(COALESCE(p_guest->>'special_requests', '')), 1000), '');
  v_marketing boolean := COALESCE((p_consent->>'marketing')::boolean, false);
  v_tz text;
  v_room jsonb;
  v_adults integer;
  v_children integer;
  o record;
  v_type record;
  v_plan record;
  v_need record;
  v_cfg jsonb;
  v_refundable boolean := true;
  v_free_days integer := 0;
  v_free_until timestamptz;
  v_guest_id uuid;
  v_reference text;
  v_total numeric := 0;
  v_currency text;
  v_rooms_out jsonb := '[]'::jsonb;
  v_res_id uuid;
  v_res_number text;
  v_requests text;
  v_booking_id uuid;
  v_idx bigint;
BEGIN
  SELECT * INTO e FROM public.booking_engines WHERE public_id = p_public_id;
  IF NOT FOUND OR NOT e.enabled OR NOT public.pms_ari_native_hotel(e.hotel_id) THEN
    RAISE EXCEPTION 'ENGINE_UNAVAILABLE';
  END IF;
  v_err := public.booking_engine_window_error(e, p_check_in, p_check_out);
  IF v_err IS NOT NULL THEN RAISE EXCEPTION '%', v_err; END IF;

  v_max_rooms := LEAST(GREATEST(COALESCE((e.booking_window->>'max_rooms')::int, 4), 1), 10);
  IF jsonb_typeof(p_rooms) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rooms) < 1
     OR jsonb_array_length(p_rooms) > v_max_rooms THEN
    RAISE EXCEPTION 'INVALID_ROOMS';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 200 OR v_first = '' OR v_last = '' THEN
    RAISE EXCEPTION 'INVALID_GUEST';
  END IF;
  IF COALESCE((p_consent->>'terms')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
  IF COALESCE(length(p_token_hash), 0) <> 64 THEN RAISE EXCEPTION 'INVALID_TOKEN'; END IF;

  -- One website booking at a time per hotel, so two guests can never both get the last room.
  PERFORM pg_advisory_xact_lock(hashtext('booking_engine:' || e.hotel_id));
  PERFORM set_config('hotelcare.ari_store_refresh', 'on', true);
  PERFORM public.pms_ari_refresh_availability(e.hotel_id, p_check_in, p_check_out);
  PERFORM set_config('hotelcare.ari_store_refresh', 'off', true);

  -- Enough rooms of each type for every night.
  FOR v_need IN
    SELECT (r->>'room_type_id')::uuid AS type_id, count(*)::int AS qty
      FROM jsonb_array_elements(p_rooms) r GROUP BY 1
  LOOP
    IF COALESCE((SELECT max(x.available) FROM public.booking_engine_offers(e.id, p_check_in, p_check_out) x
                  WHERE x.room_type_id = v_need.type_id), 0) < v_need.qty THEN
      RAISE EXCEPTION 'SOLD_OUT';
    END IF;
  END LOOP;

  -- Validate every room and its price before writing anything.
  FOR v_room IN SELECT value FROM jsonb_array_elements(p_rooms) LOOP
    SELECT * INTO o FROM public.booking_engine_offers(e.id, p_check_in, p_check_out) x
     WHERE x.room_type_id = (v_room->>'room_type_id')::uuid AND x.rate_plan_id = (v_room->>'rate_plan_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'RATE_UNAVAILABLE'; END IF;
    IF o.blocked IS NOT NULL THEN
      RAISE EXCEPTION '%', CASE WHEN o.blocked = 'sold_out' THEN 'SOLD_OUT' ELSE 'RESTRICTED' END;
    END IF;
    SELECT COALESCE(pf.max_adults, 2) AS max_adults, COALESCE(pf.max_children, 0) AS max_children,
           COALESCE(pf.max_occupancy, 2) AS max_occupancy
      INTO v_type
      FROM public.room_types rt LEFT JOIN public.room_type_profiles pf ON pf.room_type_id = rt.id
     WHERE rt.id = o.room_type_id;
    v_adults := COALESCE((v_room->>'adults')::int, 0);
    v_children := COALESCE((v_room->>'children')::int, 0);
    IF v_adults < 1 OR v_children < 0 OR v_adults > v_type.max_adults OR v_children > v_type.max_children
       OR v_adults + v_children > v_type.max_occupancy THEN
      RAISE EXCEPTION 'INVALID_OCCUPANCY';
    END IF;
    v_currency := COALESCE(v_currency, o.currency);
    IF v_currency <> o.currency THEN RAISE EXCEPTION 'RATE_UNAVAILABLE'; END IF;
    v_cfg := COALESCE(e.rate_plans -> o.rate_plan_id::text, '{}'::jsonb);
    IF NOT COALESCE((v_cfg->>'refundable')::boolean, true) THEN
      v_refundable := false;
    ELSE
      v_free_days := GREATEST(v_free_days, COALESCE((v_cfg->>'free_cancellation_days')::int,
                                                    (e.policies->>'free_cancellation_days')::int, 1));
    END IF;
  END LOOP;

  v_tz := COALESCE((SELECT c.timezone FROM public.channex_connections c WHERE c.hotel_id = e.hotel_id LIMIT 1), 'Europe/Budapest');
  IF v_refundable THEN
    -- Free cancellation until the end of the day, N days before arrival (hotel time).
    v_free_until := ((p_check_in - v_free_days)::timestamp + time '23:59:59') AT TIME ZONE v_tz;
    IF v_free_until <= now() THEN v_free_until := NULL; END IF;
  END IF;

  -- Guest profile: one per e-mail per hotel. Existing details are never overwritten.
  SELECT g.id INTO v_guest_id FROM public.guests g
   WHERE g.hotel_id = e.hotel_id AND lower(g.email) = v_email
   ORDER BY g.created_at LIMIT 1;
  IF v_guest_id IS NULL THEN
    INSERT INTO public.guests (hotel_id, organization_slug, first_name, last_name, email, phone, country, preferences)
    VALUES (e.hotel_id, e.organization_slug, v_first, v_last, v_email, v_phone, v_country,
            jsonb_build_object('source', 'website'))
    RETURNING id INTO v_guest_id;
  ELSE
    UPDATE public.guests
       SET phone = COALESCE(phone, v_phone), country = COALESCE(country, v_country), updated_at = now()
     WHERE id = v_guest_id;
  END IF;
  -- Remember the language; record marketing consent only when given (an unticked
  -- box never withdraws an earlier consent; unsubscribing does that).
  UPDATE public.guests
     SET preferences = COALESCE(preferences, '{}'::jsonb)
           || jsonb_build_object('language', v_lang)
           || CASE
                WHEN v_marketing THEN jsonb_build_object('marketing_consent', true, 'marketing_consent_at', now(),
                                                         'marketing_consent_source', 'website')
                WHEN NOT (COALESCE(preferences, '{}'::jsonb) ? 'marketing_consent') THEN jsonb_build_object('marketing_consent', false)
                ELSE '{}'::jsonb
              END
   WHERE id = v_guest_id;

  LOOP
    v_reference := 'W' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 7));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.booking_engine_bookings b WHERE b.reference = v_reference);
  END LOOP;

  v_requests := concat_ws(E'\n',
    CASE WHEN v_arrival IS NOT NULL THEN 'Expected arrival: ' || v_arrival END,
    v_request);

  FOR v_room, v_idx IN SELECT value, ordinality FROM jsonb_array_elements(p_rooms) WITH ORDINALITY LOOP
    SELECT * INTO o FROM public.booking_engine_offers(e.id, p_check_in, p_check_out) x
     WHERE x.room_type_id = (v_room->>'room_type_id')::uuid AND x.rate_plan_id = (v_room->>'rate_plan_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'SOLD_OUT'; END IF;
    SELECT rt.name AS type_name, rp.name AS plan_name INTO v_plan
      FROM public.room_types rt JOIN public.rate_plans rp ON rp.id = o.rate_plan_id
     WHERE rt.id = o.room_type_id;
    v_adults := (v_room->>'adults')::int;
    v_children := COALESCE((v_room->>'children')::int, 0);

    INSERT INTO public.reservations (
      hotel_id, organization_slug, guest_id, room_type_id, room_type_requested, status,
      check_in_date, check_out_date, adults, children,
      rate_per_night, total_amount, currency, payment_status, balance_due, payment_collect,
      source, source_reservation_id, special_requests, internal_notes, pms_guest_name
    ) VALUES (
      e.hotel_id, e.organization_slug, v_guest_id, o.room_type_id, v_plan.type_name, 'confirmed',
      p_check_in, p_check_out, v_adults, v_children,
      round(o.total / GREATEST(o.nights, 1), 2), o.total, o.currency, 'unpaid', o.total, 'property',
      -- (hotel, source, source_reservation_id) is unique: rooms of one booking get -1, -2, ...
      'website', v_reference || CASE WHEN jsonb_array_length(p_rooms) > 1 THEN '-' || v_idx ELSE '' END,
      NULLIF(v_requests, ''),
      'Website booking ' || v_reference || ' · ' || v_plan.plan_name
        || CASE WHEN v_free_until IS NULL THEN ' · non-refundable'
                ELSE ' · free cancellation until ' || to_char(v_free_until AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') END,
      -- Guest name on the booking itself, as Channex bookings carry it: search and
      -- the guest journey recognise the guest even if the profile changes later.
      v_first || ' ' || v_last
    ) RETURNING id, reservation_number INTO v_res_id, v_res_number;

    INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
    VALUES (v_res_id, e.hotel_id, e.organization_slug, 'created',
            jsonb_build_object('source', 'website', 'reference', v_reference, 'rate_plan_id', o.rate_plan_id), NULL);

    v_total := v_total + o.total;
    v_rooms_out := v_rooms_out || jsonb_build_object(
      'reservation_id', v_res_id, 'reservation_number', v_res_number,
      'room_type_id', o.room_type_id, 'rate_plan_id', o.rate_plan_id,
      'room_type_name', v_plan.type_name, 'rate_plan_name', v_plan.plan_name,
      'adults', v_adults, 'children', v_children, 'total', o.total);
  END LOOP;

  INSERT INTO public.booking_engine_bookings (
    engine_id, hotel_id, organization_slug, reference, manage_token_hash, guest_id, guest_email, guest_name,
    language, check_in_date, check_out_date, rooms, total_amount, currency, free_cancellation_until,
    attribution, consent, ip_hash, user_agent
  ) VALUES (
    e.id, e.hotel_id, e.organization_slug, v_reference, p_token_hash, v_guest_id, v_email, v_first || ' ' || v_last,
    v_lang, p_check_in, p_check_out, v_rooms_out, round(v_total, 2), v_currency, v_free_until,
    COALESCE(p_attribution, '{}'::jsonb),
    jsonb_build_object('terms', true, 'marketing', v_marketing, 'at', now()),
    left(p_ip_hash, 64), left(p_user_agent, 300)
  ) RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'ok', true, 'booking_id', v_booking_id, 'reference', v_reference,
    'hotel_id', e.hotel_id, 'organization_slug', e.organization_slug,
    'total', round(v_total, 2), 'currency', v_currency,
    'free_cancellation_until', v_free_until, 'rooms', v_rooms_out);
END;
$fn$;

-- ---------------------------------------------------------------- manage booking
CREATE OR REPLACE FUNCTION public.booking_engine_get_booking(p_public_id text, p_reference text, p_token_hash text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'ok', true,
    'reference', b.reference,
    'status', CASE
                WHEN b.status = 'cancelled' THEN 'cancelled'
                WHEN NOT EXISTS (SELECT 1 FROM public.reservations r
                                  WHERE r.id IN (SELECT (x->>'reservation_id')::uuid FROM jsonb_array_elements(b.rooms) x)
                                    AND r.status::text <> 'cancelled') THEN 'cancelled'
                ELSE 'confirmed' END,
    'guest_name', b.guest_name,
    'guest_email', b.guest_email,
    'language', b.language,
    'check_in_date', b.check_in_date,
    'check_out_date', b.check_out_date,
    'rooms', b.rooms,
    'total', b.total_amount,
    'currency', b.currency,
    'free_cancellation_until', b.free_cancellation_until,
    'can_cancel', b.status = 'confirmed'
                  AND b.free_cancellation_until IS NOT NULL AND b.free_cancellation_until > now()
                  AND NOT EXISTS (SELECT 1 FROM public.reservations r
                                   WHERE r.id IN (SELECT (x->>'reservation_id')::uuid FROM jsonb_array_elements(b.rooms) x)
                                     AND r.status::text NOT IN ('pending', 'confirmed')),
    'created_at', b.created_at
  )
  FROM public.booking_engine_bookings b
  JOIN public.booking_engines be ON be.id = b.engine_id
  WHERE be.public_id = p_public_id
    AND b.reference = upper(trim(p_reference))
    AND b.manage_token_hash = p_token_hash;
$fn$;

CREATE OR REPLACE FUNCTION public.booking_engine_cancel_booking(p_public_id text, p_reference text, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  b public.booking_engine_bookings%ROWTYPE;
  v_ids uuid[];
BEGIN
  SELECT bb.* INTO b
    FROM public.booking_engine_bookings bb
    JOIN public.booking_engines be ON be.id = bb.engine_id
   WHERE be.public_id = p_public_id AND bb.reference = upper(trim(p_reference)) AND bb.manage_token_hash = p_token_hash
   FOR UPDATE OF bb;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF b.status = 'cancelled' THEN RETURN jsonb_build_object('ok', true, 'already', true, 'booking_id', b.id); END IF;
  IF b.free_cancellation_until IS NULL OR b.free_cancellation_until <= now() THEN RAISE EXCEPTION 'NOT_CANCELLABLE'; END IF;

  SELECT array_agg((x->>'reservation_id')::uuid) INTO v_ids FROM jsonb_array_elements(b.rooms) x;
  IF EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = ANY (v_ids) AND r.status::text NOT IN ('pending', 'confirmed', 'cancelled')) THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE';
  END IF;

  WITH cancelled AS (
    UPDATE public.reservations
       SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'Cancelled online by the guest (' || b.reference || ')'
     WHERE id = ANY (v_ids) AND status::text IN ('pending', 'confirmed')
    RETURNING id
  )
  INSERT INTO public.reservation_events (reservation_id, hotel_id, organization_slug, event_type, metadata, created_by)
  SELECT c.id, b.hotel_id, b.organization_slug, 'cancelled',
         jsonb_build_object('source', 'website', 'reference', b.reference, 'by', 'guest'), NULL
    FROM cancelled c;
  UPDATE public.booking_engine_bookings SET status = 'cancelled', cancelled_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'booking_id', b.id);
END;
$fn$;

-- ---------------------------------------------------------------- grants
-- Public functions are reached only through the booking-engine edge function
-- (service role), which adds rate limits and bot checks.
REVOKE ALL ON FUNCTION public.booking_engine_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_window_error(public.booking_engines, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_offers(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_public_config(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_calendar(text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_search(text, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_create_booking(text, date, date, jsonb, jsonb, text, jsonb, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_get_booking(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_engine_cancel_booking(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_engine_hit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_window_error(public.booking_engines, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_offers(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_public_config(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_calendar(text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_search(text, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_create_booking(text, date, date, jsonb, jsonb, text, jsonb, jsonb, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_get_booking(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_engine_cancel_booking(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.booking_engine_can_manage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_engine_can_manage(text) TO authenticated, service_role;

-- ---------------------------------------------------------------- housekeeping
DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'booking-engine-rate-limit-purge';
  PERFORM cron.schedule('booking-engine-rate-limit-purge', '17 * * * *',
    $job$DELETE FROM public.booking_engine_rate_limits WHERE window_start < now() - interval '2 hours'$job$);
END;
$cron$;
