-- Disposable PostgreSQL fixture, never run on production.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 hotel text NOT NULL,
 room_number text NOT NULL,
 is_checkout_room boolean,
 pms_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.test_resolver_calls (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_number text NOT NULL
);
CREATE FUNCTION public.hc_ottofiori_reconcile_checkout_on_pms_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.hotel = 'Hotel Ottofiori' THEN
   INSERT INTO public.test_resolver_calls(room_number) VALUES (NEW.room_number);
 END IF;
 RETURN NEW;
END $$;
