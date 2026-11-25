-- Phase 1: opt-in NTAK test-scope isolation and endpoint-required names.
-- Safe defaults keep existing hotels in all-reservations mode.
ALTER TABLE public.ntak_settings
  ADD COLUMN IF NOT EXISTS accommodation_name text,
  ADD COLUMN IF NOT EXISTS provider_name text,
  ADD COLUMN IF NOT EXISTS unit_scope text NOT NULL DEFAULT 'all';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ntak_settings_unit_scope_check') THEN
    ALTER TABLE public.ntak_settings ADD CONSTRAINT ntak_settings_unit_scope_check
      CHECK (unit_scope IN ('all','profiled_only'));
  END IF;
END $$;
-- Existing mappings are still active; the UI can now disable specific types.
ALTER TABLE public.ntak_room_type_units
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Replaces only the existing nonblocking reservation trigger function.
-- Keep EXCEPTION/RAISE WARNING: reporting must never interrupt front desk.
CREATE OR REPLACE FUNCTION public.ntak_on_reservation_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.ntak_settings%ROWTYPE;
  old_status text;
  new_status text := NEW.status::text;
  booking_changed boolean := true;
BEGIN
  BEGIN
    SELECT * INTO cfg FROM public.ntak_settings WHERE hotel_id = NEW.hotel_id AND enabled;
    IF NOT FOUND THEN RETURN NEW; END IF;
    -- Restrict reporting to explicitly profiled rooms. An assigned room takes
    -- precedence over the booking's room-type mapping.
    IF cfg.unit_scope = 'profiled_only' THEN
      IF NEW.room_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.ntak_unit_profiles p
          WHERE p.hotel_id = NEW.hotel_id AND p.room_id = NEW.room_id AND p.active
        ) THEN RETURN NEW; END IF;
      ELSIF NEW.room_type_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.ntak_room_type_units t
          WHERE t.hotel_id = NEW.hotel_id AND t.room_type_id = NEW.room_type_id AND t.active
        ) THEN RETURN NEW; END IF;
      ELSE
        RETURN NEW;
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      old_status := OLD.status::text;
      booking_changed := NEW.status IS DISTINCT FROM OLD.status OR NEW.check_in_date IS DISTINCT FROM OLD.check_in_date
        OR NEW.check_out_date IS DISTINCT FROM OLD.check_out_date OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.room_type_id IS DISTINCT FROM OLD.room_type_id OR NEW.adults IS DISTINCT FROM OLD.adults
        OR NEW.children IS DISTINCT FROM OLD.children OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
        OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.guest_id IS DISTINCT FROM OLD.guest_id
        OR NEW.source IS DISTINCT FROM OLD.source OR NEW.ota_name IS DISTINCT FROM OLD.ota_name;
    END IF;

    -- Advance bookings: anything relevant to a booking that has not ended yet.
    IF NEW.check_out_date >= current_date AND booking_changed THEN
      INSERT INTO public.ntak_booking_queue (hotel_id, booking_no, dirty_at)
      VALUES (NEW.hotel_id, public.ntak_booking_no(NEW.channex_booking_id::text, NEW.pms_reservation_id::text, NEW.reservation_number, NEW.id), now())
      ON CONFLICT (hotel_id, booking_no) DO UPDATE SET dirty_at = now();
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Stay events (7.4); wrong events are corrected with the opposite event.
      IF new_status = 'checked_in' AND old_status IS DISTINCT FROM 'checked_in' THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id, is_correction)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'erkezett', NEW.room_id, old_status = 'checked_out');
      ELSIF new_status = 'checked_out' AND old_status = 'checked_in' THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'tavozott', NEW.room_id);
      ELSIF old_status = 'checked_in' AND new_status IN ('confirmed','pending','no_show','cancelled') THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id, is_correction)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'tavozott', COALESCE(OLD.room_id, NEW.room_id), true);
      ELSIF new_status = 'checked_in' AND NEW.room_id IS DISTINCT FROM OLD.room_id AND OLD.room_id IS NOT NULL AND NEW.room_id IS NOT NULL THEN
        INSERT INTO public.ntak_event_queue (hotel_id, organization_slug, reservation_id, kind, room_id, from_room_id)
        VALUES (NEW.hotel_id, cfg.organization_slug, NEW.id, 'lakoegysegetCserelt', NEW.room_id, OLD.room_id);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ntak_on_reservation_change: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
