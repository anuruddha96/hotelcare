-- Validate NEW maintenance ticket room references at insertion without changing historical tickets.
-- Older cached frontend clients still submit room_number instead of source_room_id:
-- resolve an unambiguous room within the caller's own hotel rather than breaking ticket reporting.
CREATE OR REPLACE FUNCTION public.guard_maintenance_ticket_room_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_registry_status text;
  v_registry_name text;
  v_caller_org text;
  v_legacy_room_ids uuid[];
BEGIN
  IF NEW.department IS DISTINCT FROM 'maintenance'
     OR NEW.source NOT IN ('manual', 'housekeeping') THEN
    RETURN NEW;
  END IF;

  -- The original INSERT remains protected by RLS. This check also protects
  -- against cross-organization and impersonated direct inserts.
  SELECT p.organization_slug INTO v_caller_org
  FROM public.profiles p
  WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
  IF auth.uid() IS NULL OR v_caller_org IS NULL
     OR NEW.organization_slug IS DISTINCT FROM v_caller_org
     OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Ticket organization or creator is invalid' USING ERRCODE = '42501';
  END IF;

  IF NEW.source_room_id IS NULL THEN
    IF NEW.source = 'housekeeping' THEN
      RAISE EXCEPTION 'A canonical room ID is required for a housekeeping ticket' USING ERRCODE = '22023';
    END IF;

    IF nullif(btrim(coalesce(NEW.room_number, '')), '') IS NOT NULL
       AND upper(btrim(NEW.room_number)) <> 'N/A' THEN
      -- Transitional compatibility for previously loaded browser bundles.
      -- Never accept arbitrary free text, cross-hotel matches or collisions.
      SELECT array_agg(DISTINCT r.id) INTO v_legacy_room_ids
      FROM public.rooms r
      JOIN public.hotel_configurations h ON r.hotel IN (h.hotel_id, h.hotel_name)
      JOIN public.organizations o ON o.id = h.organization_id
      LEFT JOIN public.gozsdu_housekeeping_room_registry g ON g.room_id = r.id
      WHERE r.organization_slug = NEW.organization_slug
        AND o.slug = NEW.organization_slug
        AND h.is_active = true
        AND NEW.hotel IN (h.hotel_id, h.hotel_name)
        AND (
          btrim(r.room_number) = btrim(NEW.room_number)
          OR (h.hotel_id = 'gozsdu-court' AND btrim(g.pms_room_name) = btrim(NEW.room_number))
        );
      IF coalesce(array_length(v_legacy_room_ids, 1), 0) <> 1 THEN
        RAISE EXCEPTION 'Room is unknown or ambiguous; refresh and select the room' USING ERRCODE = '22023';
      END IF;
      NEW.source_room_id := v_legacy_room_ids[1];
    ELSE
      IF NEW.description !~* '^Location:[[:space:]]*[^[:space:]]' THEN
        RAISE EXCEPTION 'Specify the common-area location' USING ERRCODE = '22023';
      END IF;
      NEW.room_number := 'N/A';
      RETURN NEW;
    END IF;
  END IF;

  SELECT r.* INTO v_room
  FROM public.rooms r
  JOIN public.hotel_configurations h ON r.hotel IN (h.hotel_id, h.hotel_name)
  JOIN public.organizations o ON o.id = h.organization_id
  WHERE r.id = NEW.source_room_id
    AND r.organization_slug = NEW.organization_slug
    AND o.slug = NEW.organization_slug
    AND h.is_active = true
    AND NEW.hotel IN (h.hotel_id, h.hotel_name)
  LIMIT 1
  FOR SHARE OF r;
  IF v_room.id IS NULL THEN
    RAISE EXCEPTION 'The selected room is not available in this hotel and organization' USING ERRCODE = '42501';
  END IF;

  IF v_room.hotel IN ('gozsdu-court', 'Gozsdu Court Budapest') THEN
    SELECT g.service_status, nullif(btrim(g.pms_room_name), '')
      INTO v_registry_status, v_registry_name
    FROM public.gozsdu_housekeeping_room_registry g
    WHERE g.room_id = v_room.id
    FOR SHARE;
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
