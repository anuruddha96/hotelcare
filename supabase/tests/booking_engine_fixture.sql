-- Minimal stand-ins for the Supabase and HotelCare objects the booking engine
-- migration uses. Column names, defaults, constraints and the ARI functions are
-- copied from production (17 Nov 2026) so the integration test exercises the
-- same rules: availability refresh, reservation number trigger and the unique
-- (hotel_id, source, source_reservation_id) index.

-- ------------------------------------------------------------ Supabase roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase grants everything in public to the API roles by default; RLS and
-- explicit REVOKEs are what actually protect objects.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE OR REPLACE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE OR REPLACE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean
LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;

-- ------------------------------------------------------------ tenancy
CREATE TYPE public.user_role AS ENUM ('housekeeping', 'reception', 'maintenance', 'manager', 'admin', 'marketing',
  'control_finance', 'hr', 'front_office', 'top_management', 'housekeeping_manager', 'maintenance_manager',
  'marketing_manager', 'reception_manager', 'back_office_manager', 'control_manager', 'finance_manager',
  'top_management_manager', 'breakfast_staff', 'back_office', 'supervisor');
CREATE TYPE public.reservation_status AS ENUM ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');

CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role public.user_role,
  is_super_admin boolean DEFAULT false,
  organization_slug text,
  hotel_ids text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE public.hotel_configurations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL UNIQUE,
  hotel_name text NOT NULL,
  organization_id uuid REFERENCES public.organizations(id),
  settings jsonb DEFAULT '{}'::jsonb,
  custom_logo_url text
);
CREATE TABLE public.channex_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL,
  currency text,
  timezone text
);

CREATE OR REPLACE FUNCTION public.is_super_admin(user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(is_super_admin, false) FROM public.profiles WHERE id = user_id;
$$;
CREATE OR REPLACE FUNCTION public.get_user_role(user_id uuid) RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT role FROM public.profiles WHERE id = user_id;
$$;
-- Simplified: super admins see everything, staff see the hotels on their profile.
CREATE OR REPLACE FUNCTION public.can_access_pms_hotel(_uid uuid, _hotel_id text, _org_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = _uid AND (COALESCE(p.is_super_admin, false) OR _hotel_id = ANY (p.hotel_ids)));
$$;

-- ------------------------------------------------------------ PMS inventory
CREATE TABLE public.room_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  name text NOT NULL,
  num_rooms integer DEFAULT 1 NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  is_sellable boolean DEFAULT true NOT NULL,
  counts_toward_inventory boolean DEFAULT true NOT NULL,
  name_translations jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE public.rate_plans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text,
  organization_slug text,
  name text NOT NULL,
  base_rate numeric(10,2) DEFAULT 0 NOT NULL,
  currency text DEFAULT 'HUF'::text,
  is_active boolean DEFAULT true,
  min_stay integer DEFAULT 1,
  max_stay integer,
  meal_plan text DEFAULT 'room_only'::text,
  created_at timestamptz DEFAULT now() NOT NULL,
  room_type_id uuid REFERENCES public.room_types(id) ON DELETE CASCADE,
  code text,
  sort_order integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.pms_ari_rates (
  hotel_id text NOT NULL,
  rate_plan_id uuid NOT NULL REFERENCES public.rate_plans(id) ON DELETE CASCADE,
  date date NOT NULL,
  rate numeric(12,2) CHECK (rate IS NULL OR rate >= 0),
  min_stay_arrival integer CHECK (min_stay_arrival IS NULL OR min_stay_arrival >= 1),
  min_stay_through integer CHECK (min_stay_through IS NULL OR min_stay_through >= 1),
  max_stay integer CHECK (max_stay IS NULL OR max_stay >= 0),
  closed_to_arrival boolean,
  closed_to_departure boolean,
  stop_sell boolean,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (rate_plan_id, date)
);
CREATE TABLE public.pms_ari_availability (
  hotel_id text NOT NULL,
  room_type_id uuid NOT NULL REFERENCES public.room_types(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_rooms integer DEFAULT 0 NOT NULL CHECK (total_rooms >= 0),
  booked integer DEFAULT 0 NOT NULL CHECK (booked >= 0),
  out_of_order integer DEFAULT 0 NOT NULL CHECK (out_of_order >= 0),
  sell_limit integer CHECK (sell_limit IS NULL OR sell_limit >= 0),
  availability integer GENERATED ALWAYS AS (GREATEST(0, (LEAST(COALESCE(sell_limit, total_rooms), (total_rooms - out_of_order)) - booked))) STORED,
  updated_at timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY (room_type_id, date)
);
CREATE TABLE public.rooms (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel text NOT NULL,
  room_number text NOT NULL,
  room_type text DEFAULT 'standard'::text
);
CREATE TABLE public.guests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  hotel_id text,
  organization_slug text,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text,
  phone text,
  nationality text,
  country text,
  preferences jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE public.reservations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_number text UNIQUE,
  hotel_id text,
  organization_slug text,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  room_type_requested text,
  status public.reservation_status DEFAULT 'pending'::public.reservation_status NOT NULL,
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  adults integer DEFAULT 1 NOT NULL,
  children integer DEFAULT 0 NOT NULL,
  total_nights integer,
  rate_per_night numeric(10,2) DEFAULT 0,
  total_amount numeric(10,2) DEFAULT 0,
  currency text DEFAULT 'HUF'::text,
  payment_status text DEFAULT 'unpaid'::text,
  balance_due numeric(10,2) DEFAULT 0,
  source text DEFAULT 'direct'::text,
  source_reservation_id text,
  special_requests text,
  internal_notes text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  pms_missing_since timestamptz,
  payment_collect text,
  room_type_id uuid REFERENCES public.room_types(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX uq_reservations_hotel_source_ref ON public.reservations USING btree (hotel_id, source, source_reservation_id);
CREATE TABLE public.reservation_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  hotel_id text,
  organization_slug text,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ------------------------------------------------------------ production ARI functions (verbatim)
CREATE OR REPLACE FUNCTION public.pms_ari_native_hotel(_hotel_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.hotel_configurations hc
      JOIN public.organizations o ON o.id = hc.organization_id
     WHERE hc.hotel_id = _hotel_id
       AND o.slug = 'channex'
       AND COALESCE((hc.settings->>'native_ari')::boolean, false)
  );
$function$;

CREATE OR REPLACE FUNCTION public.pms_ari_refresh_availability(_hotel_id text, _from date, _to date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.pms_ari_native_hotel(_hotel_id) OR _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RETURN 0;
  END IF;
  IF _to - _from > 750 THEN _to := _from + 750; END IF;

  WITH rt AS (
    SELECT id, name, num_rooms FROM public.room_types
     WHERE hotel_id = _hotel_id AND is_sellable AND counts_toward_inventory
  ), days AS (
    SELECT d::date AS date FROM generate_series(_from, _to - 1, interval '1 day') d
  ), res AS (
    SELECT r.check_in_date, r.check_out_date,
           COALESCE(r.room_type_id,
                    (SELECT rt2.id FROM rt rt2 JOIN public.rooms ro ON ro.id = r.room_id
                      WHERE rt2.name = ro.room_type LIMIT 1),
                    (SELECT rt3.id FROM rt rt3 WHERE rt3.name = r.room_type_requested LIMIT 1)) AS room_type_id
      FROM public.reservations r
     WHERE r.hotel_id = _hotel_id
       AND r.status IN ('pending', 'confirmed', 'checked_in')
       AND r.pms_missing_since IS NULL
       AND r.check_in_date < _to AND r.check_out_date > _from
  ), calc AS (
    SELECT rt.id AS room_type_id, days.date, rt.num_rooms AS total_rooms,
           (SELECT count(*) FROM res WHERE res.room_type_id = rt.id
              AND res.check_in_date <= days.date AND res.check_out_date > days.date)::int AS booked
      FROM rt CROSS JOIN days
  )
  INSERT INTO public.pms_ari_availability AS a (hotel_id, room_type_id, date, total_rooms, booked)
  SELECT _hotel_id, room_type_id, date, total_rooms, booked FROM calc
  ON CONFLICT (room_type_id, date) DO UPDATE
     SET total_rooms = EXCLUDED.total_rooms, booked = EXCLUDED.booked, updated_at = now()
   WHERE (a.total_rooms, a.booked) IS DISTINCT FROM (EXCLUDED.total_rooms, EXCLUDED.booked);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pms_ari_reservation_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_hotel text := COALESCE(NEW.hotel_id, OLD.hotel_id);
BEGIN
  IF v_hotel IS NULL OR NOT public.pms_ari_native_hotel(v_hotel) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM set_config('hotelcare.ari_store_refresh', 'on', true);
  PERFORM public.pms_ari_refresh_availability(v_hotel,
    LEAST(COALESCE(NEW.check_in_date, OLD.check_in_date), COALESCE(OLD.check_in_date, NEW.check_in_date)),
    GREATEST(COALESCE(NEW.check_out_date, OLD.check_out_date), COALESCE(OLD.check_out_date, NEW.check_out_date)));
  IF TG_OP = 'UPDATE' AND OLD.hotel_id IS DISTINCT FROM NEW.hotel_id AND OLD.hotel_id IS NOT NULL THEN
    PERFORM public.pms_ari_refresh_availability(OLD.hotel_id, OLD.check_in_date, OLD.check_out_date);
  END IF;
  PERFORM set_config('hotelcare.ari_store_refresh', 'off', true);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE TRIGGER tr_pms_ari_reservation_changed
  AFTER INSERT OR DELETE OR UPDATE OF check_in_date, check_out_date, status, room_id, room_type_id, room_type_requested, hotel_id, pms_missing_since
  ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.pms_ari_reservation_changed();

CREATE OR REPLACE FUNCTION public.generate_reservation_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  seq_num integer;
BEGIN
  SELECT COALESCE(MAX(
    CAST(NULLIF(SUBSTRING(reservation_number FROM '[0-9]+$'), '') AS integer)
  ), 0) + 1
  INTO seq_num
  FROM reservations
  WHERE reservation_number LIKE 'RES-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-%';

  NEW.reservation_number := 'RES-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-'
    || CASE WHEN seq_num < 10000 THEN LPAD(seq_num::text, 4, '0') ELSE seq_num::text END;
  NEW.total_nights := NEW.check_out_date - NEW.check_in_date;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER tr_generate_reservation_number BEFORE INSERT ON public.reservations
  FOR EACH ROW WHEN (NEW.reservation_number IS NULL) EXECUTE FUNCTION public.generate_reservation_number();

-- ------------------------------------------------------------ seed
-- native-hotel: HotelCare is the PMS (Channex org, native ARI). previo-hotel: not.
INSERT INTO public.organizations (id, slug) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'channex'),
  ('00000000-0000-0000-0000-0000000000a1', 'rdhotels');
INSERT INTO public.hotel_configurations (hotel_id, hotel_name, organization_id, settings) VALUES
  ('native-hotel', 'Native Test Hotel', '00000000-0000-0000-0000-0000000000c1', '{"native_ari": true}'),
  ('previo-hotel', 'Previo Test Hotel', '00000000-0000-0000-0000-0000000000a1', '{}');
INSERT INTO public.channex_connections (hotel_id, currency, timezone) VALUES ('native-hotel', 'USD', 'Europe/Budapest');

INSERT INTO public.profiles (id, role, is_super_admin, organization_slug, hotel_ids) VALUES
  ('00000000-0000-0000-0000-00000000aaa1', 'manager', false, 'channex', ARRAY['native-hotel', 'previo-hotel']),
  ('00000000-0000-0000-0000-00000000aaa2', 'reception', false, 'channex', ARRAY['native-hotel']),
  ('00000000-0000-0000-0000-00000000aaa3', 'manager', false, 'rdhotels', ARRAY['previo-hotel']);

INSERT INTO public.room_types (id, hotel_id, organization_slug, name, num_rooms, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000001a1', 'native-hotel', 'channex', 'Twin Room', 2, 1),
  ('00000000-0000-0000-0000-0000000001a2', 'native-hotel', 'channex', 'Double Room', 1, 2),
  ('00000000-0000-0000-0000-0000000001b1', 'previo-hotel', 'rdhotels', 'Previo Room', 3, 1);
INSERT INTO public.rate_plans (id, hotel_id, organization_slug, name, room_type_id, base_rate, currency, meal_plan, code, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000002a1', 'native-hotel', 'channex', 'Best Available Rate', '00000000-0000-0000-0000-0000000001a1', 100, 'USD', 'room_only', 'TWIN-BAR', 1),
  ('00000000-0000-0000-0000-0000000002a2', 'native-hotel', 'channex', 'Bed & Breakfast Rate', '00000000-0000-0000-0000-0000000001a1', 120, 'USD', 'breakfast', 'TWIN-BB', 2),
  ('00000000-0000-0000-0000-0000000002a3', 'native-hotel', 'channex', 'Best Available Rate', '00000000-0000-0000-0000-0000000001a2', 100, 'USD', 'room_only', 'DBL-BAR', 1),
  ('00000000-0000-0000-0000-0000000002b1', 'previo-hotel', 'rdhotels', 'Previo Rate', '00000000-0000-0000-0000-0000000001b1', 90, 'EUR', 'room_only', 'PRV', 1);

-- 120 days of rates: TWIN-BAR 95 + day-of-month/10, TWIN-BB +20, DBL-BAR 110.
INSERT INTO public.pms_ari_rates (hotel_id, rate_plan_id, date, rate, min_stay_arrival, closed_to_arrival, closed_to_departure, stop_sell)
SELECT 'native-hotel', p.id, d::date,
       CASE p.code WHEN 'TWIN-BAR' THEN 95 WHEN 'TWIN-BB' THEN 115 ELSE 110 END,
       1, false, false, false
  FROM generate_series(current_date, current_date + 120, interval '1 day') d
 CROSS JOIN public.rate_plans p WHERE p.hotel_id = 'native-hotel';

SELECT public.pms_ari_refresh_availability('native-hotel', current_date, current_date + 121);
