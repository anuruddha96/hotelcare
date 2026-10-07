-- Hotel Mika Downtown maintenance room-access guard.
-- Checkout time is planning information only. Physical departure evidence remains
-- authoritative before a checkout-room maintenance ticket can be started.

CREATE OR REPLACE FUNCTION public.get_mika_maintenance_room_access(p_ticket_id uuid)
RETURNS TABLE (
  applies boolean,
  room_id uuid,
  room_number text,
  room_type text,
  stay_kind text,
  checkout_date date,
  expected_checkout_time text,
  checked_out boolean,
  checked_out_at timestamptz,
  access_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_res public.reservations%ROWTYPE;
  v_today date := (pg_catalog.now() AT TIME ZONE 'Europe/Budapest')::date;
  v_meta jsonb := '{}'::jsonb;
  v_hotel text;
  v_departure_time text;
  v_checked_out boolean := false;
  v_checked_out_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to view maintenance room access' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_user FROM public.profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;

  IF NOT FOUND OR v_user.role::text NOT IN ('maintenance', 'maintenance_manager') THEN
    RAISE EXCEPTION 'Only maintenance team members can view room access' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR v_ticket.department IS DISTINCT FROM 'maintenance' THEN
    RAISE EXCEPTION 'Maintenance ticket not found' USING ERRCODE = '22023';
  END IF;

  IF v_user.organization_slug IS NULL
     OR v_ticket.organization_slug IS DISTINCT FROM v_user.organization_slug
     OR v_user.assigned_hotel IS NULL
     OR v_ticket.hotel IS NULL
     OR public.get_hotel_name_from_id(v_user.assigned_hotel)
        IS DISTINCT FROM public.get_hotel_name_from_id(v_ticket.hotel) THEN
    RAISE EXCEPTION 'Ticket is outside your assigned property' USING ERRCODE = '42501';
  END IF;

  v_hotel := public.get_hotel_name_from_id(v_ticket.hotel);
  applies := v_hotel = 'Hotel Mika Downtown';
  room_id := v_ticket.source_room_id;
  room_number := v_ticket.room_number;
  expected_checkout_time := '10:00';

  IF NOT applies OR v_ticket.source_room_id IS NULL THEN
    access_state := CASE WHEN applies THEN 'room_unlinked' ELSE 'not_applicable' END;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_room FROM public.rooms
  WHERE id = v_ticket.source_room_id
    AND organization_slug = v_ticket.organization_slug;

  IF NOT FOUND THEN
    access_state := 'room_unlinked';
    RETURN NEXT;
    RETURN;
  END IF;

  room_id := v_room.id;
  room_number := v_room.room_number;
  room_type := coalesce(v_room.room_category, v_room.room_type, v_room.room_name);
  v_meta := coalesce(v_room.pms_metadata::jsonb, '{}'::jsonb);

  SELECT * INTO v_res
  FROM public.reservations r
  WHERE r.room_id = v_room.id
    AND r.source = 'previo'
    AND r.status::text NOT IN ('cancelled', 'no_show')
    AND r.check_in_date <= v_today
    AND r.check_out_date >= v_today
  ORDER BY
    CASE WHEN r.status::text = 'checked_in' THEN 0 WHEN r.status::text = 'checked_out' THEN 1 ELSE 2 END,
    r.updated_at DESC
  LIMIT 1;

  checkout_date := CASE WHEN FOUND THEN v_res.check_out_date ELSE NULL END;
  IF checkout_date IS NULL AND coalesce((v_meta->>'scheduledDepartureToday')::boolean, false) THEN
    checkout_date := v_today;
  END IF;

  v_departure_time := nullif(v_meta->>'departureTime', '');
  IF v_departure_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    expected_checkout_time := v_departure_time;
  END IF;

  v_checked_out := coalesce((v_meta->>'checkedOutToday')::boolean, false)
    OR (v_room.checkout_time IS NOT NULL AND v_room.is_checkout_room = true)
    OR (FOUND AND v_res.status::text = 'checked_out' AND v_res.check_out_date = v_today);

  BEGIN
    v_checked_out_at := nullif(v_meta->>'checkedOutAt', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_checked_out_at := NULL;
  END;
  IF v_checked_out_at IS NULL AND v_checked_out THEN
    v_checked_out_at := coalesce(v_room.checkout_time, v_res.actual_check_out);
  END IF;
  checked_out := v_checked_out;
  checked_out_at := v_checked_out_at;

  IF checkout_date = v_today OR v_room.is_checkout_room = true THEN
    stay_kind := 'checkout';
    access_state := CASE WHEN v_checked_out THEN 'ready_to_fix' ELSE 'waiting_for_checkout' END;
  ELSIF FOUND AND v_res.check_in_date <= v_today AND v_res.check_out_date > v_today THEN
    stay_kind := 'stayover';
    access_state := 'consent_required';
  ELSE
    stay_kind := 'vacant';
    access_state := 'ready_to_fix';
  END IF;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_mika_maintenance_room_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_mika_maintenance_room_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_mika_maintenance_ticket(
  p_ticket_id uuid,
  p_expected_updated_at timestamptz,
  p_access_confirmation text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_access record;
  v_confirmation text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_access_confirmation, '')));
  v_note text;
BEGIN
  SELECT * INTO v_access FROM public.get_mika_maintenance_room_access(p_ticket_id);

  IF NOT coalesce(v_access.applies, false) THEN
    PERFORM public.work_maintenance_ticket(p_ticket_id, 'start', NULL, p_expected_updated_at, NULL, NULL);
    RETURN;
  END IF;

  IF v_access.access_state = 'waiting_for_checkout' THEN
    RAISE EXCEPTION 'Guest is still in this checkout room. Wait for verified Previo checkout before starting work.'
      USING ERRCODE = '22023';
  END IF;

  IF v_access.access_state = 'room_unlinked' THEN
    RAISE EXCEPTION 'This Mika room ticket is not linked to a room. Ask reception to correct the ticket before entry.'
      USING ERRCODE = '22023';
  END IF;

  IF v_access.access_state = 'consent_required'
     AND v_confirmation NOT IN ('guest_permission', 'guest_out') THEN
    RAISE EXCEPTION 'Confirm guest permission or that the guest is out before entering this stayover room.'
      USING ERRCODE = '22023';
  END IF;

  v_note := CASE
    WHEN v_access.access_state = 'consent_required' AND v_confirmation = 'guest_permission'
      THEN 'Mika room access confirmed: guest gave permission before entry.'
    WHEN v_access.access_state = 'consent_required' AND v_confirmation = 'guest_out'
      THEN 'Mika room access confirmed: guest is out / room accessible before entry.'
    WHEN v_access.access_state = 'ready_to_fix' AND v_access.stay_kind = 'checkout'
      THEN 'Mika room access confirmed by verified checkout. RTF — Ready to Fix.'
    ELSE 'Mika room access confirmed: room is ready to fix.'
  END;

  PERFORM public.work_maintenance_ticket(p_ticket_id, 'start', NULL, p_expected_updated_at, NULL, NULL);

  INSERT INTO public.comments(ticket_id, user_id, organization_slug, content)
  SELECT t.id, auth.uid(), t.organization_slug, '[Mika room access] ' || v_note
  FROM public.tickets t WHERE t.id = p_ticket_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_mika_maintenance_ticket(uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_mika_maintenance_ticket(uuid,timestamptz,text) TO authenticated;
