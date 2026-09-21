-- Ticket creation must never trust a room label submitted by the browser.
-- Historical tickets are left untouched. This validates NEW inserts only, and
-- intentionally does not prohibit later status changes to an existing room.
-- Deploy together with both new maintenance creation forms (cached old clients
-- that submit a room string without source_room_id will receive an error).
CREATE OR REPLACE FUNCTION public.guard_maintenance_ticket_room_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_hotel_id text;
  v_hotel_name text;
  v_registry_status text;
  v_registry_name text;
  v_caller_org text;
BEGIN
  IF NEW.department IS DISTINCT FROM 'maintenance'
     OR NEW.source NOT IN ('manual', 'housekeeping') THEN
    RETURN NEW;
  END IF;

  -- RLS remains active for the original INSERT; this function adds a final
  -- fail-closed, database-transaction-time ownership and eligibility check.
  SELECT p.organization_slug INTO v_caller_org
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_caller_org IS NULL
     OR NEW.organization_slug IS DISTINCT FROM v_caller_org
     OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Ticket organization or creator is invalid' USING ERRCODE = '42501';
  END IF;

  IF NEW.source_room_id IS NULL THEN
    IF NEW.source = 'housekeeping'
       OR coalesce(nullif(btrim(NEW.room_number), ''), 'N/A') <> 'N/A' THEN
      RAISE EXCEPTION 'A canonical room ID is required for a room ticket' USING ERRCODE = '22023';
    END IF;
    IF NEW.description !~* '^Location:[[:space:]]*[^[:space:]]' THEN
      RAISE EXCEPTION 'Specify the common-area location' USING ERRCODE = '22023';
    END IF;
    NEW.room_number := 'N/A';
    RETURN NEW;
  END IF;

  SELECT r.*, h.hotel_id, h.hotel_name
    INTO v_room, v_hotel_id, v_hotel_name
  FROM public.rooms r
  JOIN public.hotel_configurations h
    ON r.hotel IN (h.hotel_id, h.hotel_name)
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE r.id = NEW.source_room_id
    AND r.organization_slug = NEW.organization_slug
    AND o.slug = NEW.organization_slug
    AND h.is_active = true
    AND NEW.hotel IN (h.hotel_id, h.hotel_name)
  LIMIT 1;

  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'The selected room is not available in this hotel and organization' USING ERRCODE = '42501';
  END IF;

  IF v_hotel_id = 'gozsdu-court' THEN
    SELECT g.service_status, nullif(btrim(g.pms_room_name), '')
      INTO v_registry_status, v_registry_name
    FROM public.gozsdu_housekeeping_room_registry g
    WHERE g.room_id = v_room.id;
    IF v_registry_status IS DISTINCT FROM 'operating' OR v_registry_name IS NULL THEN
      RAISE EXCEPTION 'This Gozsdu room is not in the active housekeeping inventory' USING ERRCODE = '22023';
    END IF;
    NEW.room_number := v_registry_name;
    IF NEW.source = 'housekeeping' THEN
      NEW.title := 'Room ' || v_registry_name || ': ' || left(btrim(NEW.description), 80);
    END IF;
  ELSE
    IF lower(coalesce(v_room.status, '')) IN ('out_of_order', 'unavailable', 'decommissioned') THEN
      RAISE EXCEPTION 'This room is unavailable for new maintenance tickets' USING ERRCODE = '22023';
    END IF;
    NEW.room_number := v_room.room_number;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_maintenance_ticket_room_eligibility ON public.tickets;
CREATE TRIGGER trg_guard_maintenance_ticket_room_eligibility
  BEFORE INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_maintenance_ticket_room_eligibility();

REVOKE ALL ON FUNCTION public.guard_maintenance_ticket_room_eligibility() FROM PUBLIC;
