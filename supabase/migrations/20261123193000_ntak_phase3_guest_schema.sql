-- NTAK Phase 3: per-guest lifecycle, event recipients and booking numbers.
-- Manual migration. Apply only after Phase 2; do not publish reception UI first.
ALTER TABLE public.reservation_guests
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS departed_at timestamptz,
  ADD COLUMN IF NOT EXISTS room_id uuid REFERENCES public.rooms(id),
  ADD COLUMN IF NOT EXISTS stay_state text NOT NULL DEFAULT 'expected';
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='reservation_guests_stay_state_check' AND conrelid='public.reservation_guests'::regclass) THEN
    ALTER TABLE public.reservation_guests ADD CONSTRAINT reservation_guests_stay_state_check
      CHECK(stay_state IN ('expected','in_house','departed','void'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS reservation_guests_current
  ON public.reservation_guests(reservation_id,stay_state,room_id);
ALTER TABLE public.ntak_event_queue ADD COLUMN IF NOT EXISTS guest_ids uuid[];
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS ntak_booking_no text;
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='reservations_ntak_booking_no_length_check' AND conrelid='public.reservations'::regclass) THEN
    ALTER TABLE public.reservations ADD CONSTRAINT reservations_ntak_booking_no_length_check
      CHECK (ntak_booking_no IS NULL OR length(btrim(ntak_booking_no)) BETWEEN 1 AND 255);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS reservations_ntak_booking_no_hotel
  ON public.reservations(hotel_id,ntak_booking_no) WHERE ntak_booking_no IS NOT NULL;

-- Existing NTAK-managed in-house guests retain their current stay state.
-- Never rewrite a historical guest timestamp once explicitly recorded.
UPDATE public.reservation_guests rg
SET stay_state=CASE WHEN r.status='checked_out' THEN 'departed' ELSE 'in_house' END,
    arrived_at=COALESCE(rg.arrived_at,r.actual_check_in,r.check_in_date::timestamp AT TIME ZONE 'Europe/Budapest'),
    departed_at=CASE WHEN r.status='checked_out' THEN COALESCE(rg.departed_at,r.actual_check_out,r.check_out_date::timestamp AT TIME ZONE 'Europe/Budapest') ELSE rg.departed_at END,
    room_id=COALESCE(rg.room_id,r.room_id)
FROM public.reservations r JOIN public.ntak_settings cfg ON cfg.hotel_id=r.hotel_id AND cfg.enabled
WHERE rg.reservation_id=r.id AND rg.stay_state='expected' AND r.status IN ('checked_in','checked_out');

-- Preserve the existing four-argument ntak_booking_no function as a legacy
-- entrypoint; five arguments route the explicit override ahead of OTA IDs.
CREATE OR REPLACE FUNCTION public.ntak_booking_no(
  _override text,_channex_booking_id text,_pms_reservation_id text,
  _reservation_number text,_id uuid
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT left(COALESCE(NULLIF(btrim(_override),''),
    NULLIF(_channex_booking_id,''),NULLIF(_pms_reservation_id,''),
    NULLIF(_reservation_number,''),_id::text),255)
$$;

-- Existing non-NTAK hotels retain their direct guest-link workflow.
-- NTAK-enabled hotels must use the audited RPCs; their direct REST writes
-- are denied by RLS, even when authenticated has table grants.
ALTER TABLE public.reservation_guests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "PMS staff manage stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "PMS staff view stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "Legacy PMS staff insert stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "Legacy PMS staff update stay guests" ON public.reservation_guests;
DROP POLICY IF EXISTS "Legacy PMS staff delete stay guests" ON public.reservation_guests;
CREATE POLICY "PMS staff view stay guests"
ON public.reservation_guests FOR SELECT TO authenticated USING (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
);
CREATE POLICY "Legacy PMS staff insert stay guests"
ON public.reservation_guests FOR INSERT TO authenticated WITH CHECK (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled)
);
CREATE POLICY "Legacy PMS staff update stay guests"
ON public.reservation_guests FOR UPDATE TO authenticated USING (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled)
) WITH CHECK (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled)
);
CREATE POLICY "Legacy PMS staff delete stay guests"
ON public.reservation_guests FOR DELETE TO authenticated USING (
  public.has_pms_access(auth.uid()) AND public.can_access_reservation(auth.uid(),reservation_id)
  AND NOT EXISTS(
    SELECT 1 FROM public.ntak_settings cfg JOIN public.reservations r ON r.id=reservation_id
    WHERE cfg.hotel_id=r.hotel_id AND cfg.enabled)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.reservation_guests TO authenticated;

-- Reservation changes triggered *by* the per-guest RPC must not also generate
-- a second all-guests event. Legacy non-NTAK flows keep their original logic.
CREATE OR REPLACE FUNCTION public.ntak_on_reservation_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.ntak_settings%ROWTYPE;
  old_status text;
  new_status text := NEW.status::text;
  booking_changed boolean := true;
  moment_at timestamptz;
BEGIN
  BEGIN
    SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id=NEW.hotel_id AND enabled;
    IF NOT FOUND THEN RETURN NEW; END IF;
    IF cfg.unit_scope='profiled_only' THEN
      IF NEW.room_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM public.ntak_unit_profiles p WHERE p.hotel_id=NEW.hotel_id AND p.room_id=NEW.room_id AND p.active) THEN RETURN NEW; END IF;
      ELSIF NEW.room_type_id IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM public.ntak_room_type_units t WHERE t.hotel_id=NEW.hotel_id AND t.room_type_id=NEW.room_type_id AND t.active) THEN RETURN NEW; END IF;
      ELSE RETURN NEW; END IF;
    END IF;
    IF current_setting('hotelcare.guest_lifecycle',true)='1' THEN RETURN NEW; END IF;
    moment_at := COALESCE(NULLIF(current_setting('hotelcare.business_moment',true),'')::timestamptz,clock_timestamp());
    IF TG_OP='UPDATE' THEN
      old_status := OLD.status::text;
      booking_changed := NEW.status IS DISTINCT FROM OLD.status OR NEW.check_in_date IS DISTINCT FROM OLD.check_in_date
        OR NEW.check_out_date IS DISTINCT FROM OLD.check_out_date OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.room_type_id IS DISTINCT FROM OLD.room_type_id OR NEW.adults IS DISTINCT FROM OLD.adults
        OR NEW.children IS DISTINCT FROM OLD.children OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
        OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.guest_id IS DISTINCT FROM OLD.guest_id
        OR NEW.source IS DISTINCT FROM OLD.source OR NEW.ota_name IS DISTINCT FROM OLD.ota_name
        OR NEW.ntak_booking_no IS DISTINCT FROM OLD.ntak_booking_no;
    END IF;
    IF NEW.check_out_date>=current_date AND booking_changed THEN
      INSERT INTO public.ntak_booking_queue(hotel_id,booking_no,dirty_at)
      VALUES(NEW.hotel_id,public.ntak_booking_no(NEW.ntak_booking_no,NEW.channex_booking_id::text,NEW.pms_reservation_id::text,NEW.reservation_number,NEW.id),now())
      ON CONFLICT(hotel_id,booking_no) DO UPDATE SET dirty_at=now();
    END IF;
    IF cfg.first_closure_date IS NOT NULL AND (moment_at AT TIME ZONE 'Europe/Budapest')::date < cfg.first_closure_date THEN
      RAISE WARNING 'NTAK event ignored: business day before first_closure_date %',cfg.first_closure_date;
      RETURN NEW;
    END IF;
    IF TG_OP='UPDATE' THEN
      IF new_status='checked_in' AND old_status IS DISTINCT FROM 'checked_in' THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,is_correction,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'erkezett',NEW.room_id,old_status='checked_out',moment_at);
      ELSIF new_status='checked_out' AND old_status='checked_in' THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'tavozott',NEW.room_id,moment_at);
      ELSIF old_status='checked_in' AND new_status IN ('confirmed','pending','no_show','cancelled') THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,is_correction,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'tavozott',COALESCE(OLD.room_id,NEW.room_id),true,moment_at);
      ELSIF new_status='checked_in' AND NEW.room_id IS DISTINCT FROM OLD.room_id AND OLD.room_id IS NOT NULL AND NEW.room_id IS NOT NULL THEN
        INSERT INTO public.ntak_event_queue(hotel_id,organization_slug,reservation_id,kind,room_id,from_room_id,occurred_at)
        VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,'lakoegysegetCserelt',NEW.room_id,OLD.room_id,moment_at);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ntak_on_reservation_change: %',SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Legacy VIZA check-ins now report all linked guests. Per-guest RPCs queue
-- individually and suppress this reservation-level status trigger.
CREATE OR REPLACE FUNCTION public.viza_on_reservation_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg public.viza_settings%ROWTYPE; moment_at timestamptz;
  link record;
BEGIN
  SELECT * INTO cfg FROM public.viza_settings WHERE hotel_id=NEW.hotel_id AND enabled AND adatszolgaltatasi_azonosito IS NOT NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF current_setting('hotelcare.guest_lifecycle',true)='1' THEN RETURN NEW; END IF;
  moment_at := COALESCE(NULLIF(current_setting('hotelcare.business_moment',true),'')::timestamptz,clock_timestamp());
  IF OLD.status='checked_out' AND NEW.status='checked_in' THEN
    -- Reopen unsent departures. Never silently retract a departure already
    -- transmitted to VIZA; flag it for a supervised correction.
    UPDATE public.viza_guest_events SET tavozas_ideje=NULL,departure_state=NULL,updated_at=now()
      WHERE reservation_id=NEW.id AND departure_state IS DISTINCT FROM 'sent';
    UPDATE public.viza_guest_events SET last_error='Departure already sent to VIZA; manual correction required after undo',
      updated_at=now()
      WHERE reservation_id=NEW.id AND departure_state='sent';
  ELSIF OLD.status='checked_in' AND NEW.status IN ('confirmed','pending') THEN
    DELETE FROM public.viza_guest_events WHERE reservation_id=NEW.id AND arrival_state='queued';
    UPDATE public.viza_guest_events SET
      last_error='Arrival already sent to VIZA; manual correction required after undo',updated_at=now()
      WHERE reservation_id=NEW.id AND arrival_state='sent';
  ELSIF NEW.status='checked_in' AND OLD.status IS DISTINCT FROM 'checked_in' THEN
    -- Legacy whole-reservation paths must report every linked guest, not only the booker.
    FOR link IN SELECT rg.guest_id FROM public.reservation_guests rg
      WHERE rg.reservation_id=NEW.id
    LOOP
      INSERT INTO public.viza_guest_events(hotel_id,organization_slug,reservation_id,guest_id,erkezes_ideje,tavozas_varhato_datuma)
      VALUES(NEW.hotel_id,cfg.organization_slug,NEW.id,link.guest_id,COALESCE(NEW.actual_check_in,moment_at),NEW.check_out_date)
      ON CONFLICT (reservation_id,COALESCE(guest_id,'00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
    END LOOP;
  ELSIF NEW.status='checked_out' AND OLD.status IS DISTINCT FROM 'checked_out' THEN
    UPDATE public.viza_guest_events SET tavozas_ideje=COALESCE(NEW.actual_check_out,moment_at),
      departure_state=CASE WHEN arrival_state='sent' THEN 'queued' ELSE departure_state END,updated_at=now()
      WHERE reservation_id=NEW.id AND tavozas_ideje IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
