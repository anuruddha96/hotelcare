-- VIZA / THF foundation (Hungarian guest-data reporting, 2016. évi CLVI. tv.).
-- Per-hotel settings + an event queue filled automatically at check-in and
-- check-out. The viza-thf edge function drains the queue and polls THF status;
-- certificates live in function secrets and never touch the client.

CREATE TABLE IF NOT EXISTS public.viza_settings (
  hotel_id text PRIMARY KEY,
  organization_slug text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  environment text NOT NULL DEFAULT 'test' CHECK (environment IN ('test','production')),
  thf_url text NOT NULL DEFAULT 'https://thf-uat.thf.hu/ws',
  -- Accommodation identity sent in every message (spec: szallashely block).
  adatszolgaltatasi_azonosito text CHECK (adatszolgaltatasi_azonosito ~ '^[a-zA-Z0-9]{8}$'),
  szallas_nev text,
  szolgaltato_adoszam text CHECK (szolgaltato_adoszam ~ '^[0-9]{8}-[0-9]-[0-9]{2}$'),
  szolgaltato_nev text,
  -- Status endpoint results; the spec requires showing these to users.
  last_status_code text,
  last_status_at timestamptz,
  unsent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.viza_guest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  organization_slug text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  guest_id uuid,
  -- Same UUID on arrival and departure so VIZA can join them (spec 2.2).
  erkezes_azonosito uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  erkezes_ideje timestamptz NOT NULL,
  tavozas_varhato_datuma date NOT NULL,
  tavozas_ideje timestamptz,
  arrival_state text NOT NULL DEFAULT 'queued'
    CHECK (arrival_state IN ('queued','sent','failed','blocked')),
  departure_state text
    CHECK (departure_state IS NULL OR departure_state IN ('queued','sent','failed')),
  arrival_fogadas_azonosito text,
  departure_fogadas_azonosito text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS viza_guest_events_res_guest
  ON public.viza_guest_events(reservation_id, COALESCE(guest_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS viza_guest_events_pending
  ON public.viza_guest_events(hotel_id, updated_at)
  WHERE arrival_state = 'queued' OR departure_state = 'queued' OR arrival_state = 'failed' OR departure_state = 'failed';

ALTER TABLE public.viza_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.viza_guest_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PMS staff view VIZA settings"
ON public.viza_settings FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id));

CREATE POLICY "PMS staff view VIZA events"
ON public.viza_guest_events FOR SELECT TO authenticated
USING (public.user_can_access_hotel(auth.uid(), hotel_id) AND public.has_pms_access(auth.uid()));
-- Writes: service role only (edge function + the triggers below run as owner).

-- Document-reader output captured at check-in, stored unchanged (the spec
-- separates scanned data from manual input in the arrival message).
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS document_scan jsonb;

-- Queue events automatically so reporting needs no extra taps at the desk.
CREATE OR REPLACE FUNCTION public.viza_on_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.viza_settings%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.viza_settings
   WHERE hotel_id = NEW.hotel_id AND enabled = true
     AND adatszolgaltatasi_azonosito IS NOT NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.status = 'checked_in' AND COALESCE(OLD.status, '') <> 'checked_in' THEN
    INSERT INTO public.viza_guest_events
      (hotel_id, organization_slug, reservation_id, guest_id, erkezes_ideje, tavozas_varhato_datuma)
    VALUES
      (NEW.hotel_id, cfg.organization_slug, NEW.id, NEW.guest_id, now(), NEW.check_out_date)
    ON CONFLICT (reservation_id, COALESCE(guest_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO NOTHING;
  ELSIF NEW.status = 'checked_out' AND COALESCE(OLD.status, '') <> 'checked_out' THEN
    UPDATE public.viza_guest_events
       SET tavozas_ideje = now(),
           departure_state = CASE WHEN arrival_state = 'sent' THEN 'queued' ELSE departure_state END,
           updated_at = now()
     WHERE reservation_id = NEW.id AND tavozas_ideje IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.viza_on_reservation_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS viza_on_reservation_status ON public.reservations;
CREATE TRIGGER viza_on_reservation_status
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.viza_on_reservation_status();

-- Worker helper: mark a batch failed and count the attempt in one statement.
CREATE OR REPLACE FUNCTION public.viza_bump_attempts(_ids uuid[], _kind text, _error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.viza_guest_events
     SET arrival_state   = CASE WHEN _kind = 'arrival' THEN 'failed' ELSE arrival_state END,
         departure_state = CASE WHEN _kind = 'departure' THEN 'failed' ELSE departure_state END,
         attempts = attempts + 1,
         last_error = left(_error, 300),
         updated_at = now()
   WHERE id = ANY(_ids);
$$;
REVOKE ALL ON FUNCTION public.viza_bump_attempts(uuid[], text, text) FROM PUBLIC, anon, authenticated;

-- Drain the queue + poll THF status (spec: poll every 1–60 minutes).
SELECT cron.schedule(
  'viza-thf-worker-10min',
  '4-59/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/viza-thf',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', public.get_channex_worker_secret()),
    body := jsonb_build_object('action', 'worker')
  );
  $$
);
