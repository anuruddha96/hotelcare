-- Gozsdu Court Budapest ONLY: housekeeping operational inventory is distinct
-- from Previo room mappings and from room-cleaning status. No guest list, room
-- availability spreadsheet or other tenant's inventory is committed here.
CREATE TABLE IF NOT EXISTS public.gozsdu_housekeeping_room_registry (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  pms_room_name text NOT NULL UNIQUE,
  building_code text NOT NULL CHECK (building_code IN ('ST', '1B', '1BBALC', '2B', '3B')),
  service_status text NOT NULL CHECK (service_status IN ('operating', 'unavailable', 'non_guest')),
  unavailability_reason text,
  source_date date,
  source_file text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gozsdu_housekeeping_room_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gozsdu_housekeeping_room_registry FROM anon, authenticated;
GRANT SELECT ON public.gozsdu_housekeeping_room_registry TO authenticated;
DROP POLICY IF EXISTS gozsdu_registry_hotel_read ON public.gozsdu_housekeeping_room_registry;
CREATE POLICY gozsdu_registry_hotel_read ON public.gozsdu_housekeeping_room_registry
FOR SELECT TO authenticated USING (
  public.user_can_access_hotel((SELECT auth.uid()), 'gozsdu-court')
  AND EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id AND r.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest'))
);

-- Alphabetically after trg_apply_gozsdu_housekeeping_cycle, so its standard
-- towel/linen computation remains unchanged for operating rooms, and is
-- cleared ONLY for explicitly unavailable, non-guest or unmapped Gozsdu rooms.
CREATE OR REPLACE FUNCTION public.enforce_gozsdu_operational_room()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE entry public.gozsdu_housekeeping_room_registry%ROWTYPE;
DECLARE state text := 'unmapped';
DECLARE meta jsonb;
BEGIN
  IF NEW.hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN RETURN NEW; END IF;
  SELECT * INTO entry FROM public.gozsdu_housekeeping_room_registry WHERE room_id = NEW.id;
  IF FOUND THEN state := entry.service_status; END IF;
  meta := COALESCE(NEW.pms_metadata, '{}'::jsonb);
  NEW.pms_metadata := jsonb_set(meta, '{gozsduAvailability}',
    jsonb_build_object('status', state, 'reason', entry.unavailability_reason,
      'pmsRoomName', entry.pms_room_name, 'buildingCode', entry.building_code), true);
  IF state <> 'operating' THEN
    NEW.towel_change_required := false;
    NEW.linen_change_required := false;
    NEW.pms_metadata := jsonb_set(NEW.pms_metadata, '{gozsduHousekeeping,serviceType}', '"none"'::jsonb, true);
    NEW.pms_metadata := jsonb_set(NEW.pms_metadata, '{gozsduHousekeeping,serviceDue}', 'false'::jsonb, true);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS zz_gozsdu_operational_room ON public.rooms;
CREATE TRIGGER zz_gozsdu_operational_room
BEFORE INSERT OR UPDATE OF hotel, guest_nights_stayed, is_checkout_room, pms_metadata
ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.enforce_gozsdu_operational_room();

-- Registry updates regenerate the protected metadata without touching PMS
-- identity, reservation data, cleaning status or any room in another hotel.
CREATE OR REPLACE FUNCTION public.refresh_gozsdu_operational_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_id uuid;
BEGIN
  target_id := COALESCE(NEW.room_id, OLD.room_id);
  UPDATE public.rooms r SET pms_metadata = COALESCE(r.pms_metadata, '{}'::jsonb)
  WHERE r.id = target_id AND r.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest');
  RETURN NULL;
END; $$;
DROP TRIGGER IF EXISTS trg_refresh_gozsdu_registry ON public.gozsdu_housekeeping_room_registry;
CREATE TRIGGER trg_refresh_gozsdu_registry
AFTER INSERT OR UPDATE OR DELETE ON public.gozsdu_housekeeping_room_registry
FOR EACH ROW EXECUTE FUNCTION public.refresh_gozsdu_operational_metadata();

-- Fail closed for future assignment writes even if an older client ignores
-- the UI's inactive-room filter; existing historical assignments stay intact.
CREATE OR REPLACE FUNCTION public.reject_inactive_gozsdu_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_hotel text;
BEGIN
  IF NEW.assignment_date < (now() AT TIME ZONE 'Europe/Budapest')::date THEN RETURN NEW; END IF;
  SELECT r.hotel INTO target_hotel FROM public.rooms r WHERE r.id = NEW.room_id;
  IF target_hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gozsdu_housekeeping_room_registry g
                 WHERE g.room_id = NEW.room_id AND g.service_status = 'operating') THEN
    RAISE EXCEPTION 'This Gozsdu room is not in the operating housekeeping inventory'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_reject_inactive_gozsdu_assignment ON public.room_assignments;
CREATE TRIGGER trg_reject_inactive_gozsdu_assignment
BEFORE INSERT OR UPDATE OF room_id, assignment_date, assigned_to ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.reject_inactive_gozsdu_assignment();

CREATE OR REPLACE FUNCTION public.reject_inactive_gozsdu_next_day_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_hotel text;
DECLARE target_date date;
BEGIN
  SELECT r.hotel INTO target_hotel FROM public.rooms r WHERE r.id = NEW.room_id;
  IF target_hotel NOT IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN RETURN NEW; END IF;
  SELECT p.plan_date INTO target_date FROM public.next_day_housekeeping_plans p WHERE p.id = NEW.plan_id;
  IF target_date < (now() AT TIME ZONE 'Europe/Budapest')::date THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gozsdu_housekeeping_room_registry g
                 WHERE g.room_id = NEW.room_id AND g.service_status = 'operating') THEN
    RAISE EXCEPTION 'Inactive Gozsdu room cannot enter a future housekeeping plan'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_reject_inactive_gozsdu_plan ON public.next_day_housekeeping_plan_items;
CREATE TRIGGER trg_reject_inactive_gozsdu_plan
BEFORE INSERT OR UPDATE OF room_id, plan_id ON public.next_day_housekeeping_plan_items
FOR EACH ROW EXECUTE FUNCTION public.reject_inactive_gozsdu_next_day_plan();
