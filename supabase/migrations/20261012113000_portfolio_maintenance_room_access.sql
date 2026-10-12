-- Shared maintenance access awareness for RD Hotels and SLNT.
-- Report PMS evidence, never claim physical presence, and require an entry confirmation
-- when the latest room state does not establish that entry is appropriate.
CREATE OR REPLACE FUNCTION public.get_maintenance_room_access(p_ticket_id uuid)
RETURNS TABLE(
  applies boolean, room_id uuid, room_number text, room_type text,
  stay_kind text, checkout_date date, expected_checkout_time text,
  checked_out boolean, checked_out_at timestamptz, access_state text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_meta jsonb;
  v_today date := (pg_catalog.now() AT TIME ZONE 'Europe/Budapest')::date;
  v_candidates integer;
  v_departure text;
  v_out_at timestamptz;
  v_sync_ok boolean;
  v_occupied boolean;
  v_arrival boolean;
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
    OR v_user.assigned_hotel IS NULL OR v_ticket.hotel IS NULL
    OR public.get_hotel_name_from_id(v_user.assigned_hotel)
      IS DISTINCT FROM public.get_hotel_name_from_id(v_ticket.hotel) THEN
    RAISE EXCEPTION 'Ticket is outside your assigned property' USING ERRCODE = '42501';
  END IF;

  applies := v_ticket.source_room_id IS NOT NULL OR (
    nullif(pg_catalog.btrim(coalesce(v_ticket.room_number, '')), '') IS NOT NULL
    AND pg_catalog.upper(pg_catalog.btrim(v_ticket.room_number)) NOT IN ('N/A', 'NA', '-')
  );
  room_id := NULL;
  room_number := v_ticket.room_number;
  expected_checkout_time := NULL;
  checked_out := false;
  IF NOT applies THEN
    access_state := 'not_applicable';
    RETURN NEXT; RETURN;
  END IF;

  IF v_ticket.source_room_id IS NOT NULL THEN
    SELECT * INTO v_room FROM public.rooms r
      WHERE r.id = v_ticket.source_room_id
        AND r.organization_slug = v_ticket.organization_slug
        AND public.get_hotel_name_from_id(r.hotel) =
            public.get_hotel_name_from_id(v_ticket.hotel);
  ELSE
    -- Legacy tickets: resolve by number only when exactly one room matches
    -- *within the same tenant and property*. Never guess a duplicate number.
    SELECT count(*) INTO v_candidates FROM public.rooms r
      WHERE r.organization_slug = v_ticket.organization_slug
        AND public.get_hotel_name_from_id(r.hotel) =
            public.get_hotel_name_from_id(v_ticket.hotel)
        AND pg_catalog.lower(pg_catalog.btrim(r.room_number)) =
            pg_catalog.lower(pg_catalog.btrim(v_ticket.room_number));
    IF v_candidates = 1 THEN
      SELECT * INTO v_room FROM public.rooms r
        WHERE r.organization_slug = v_ticket.organization_slug
          AND public.get_hotel_name_from_id(r.hotel) =
              public.get_hotel_name_from_id(v_ticket.hotel)
          AND pg_catalog.lower(pg_catalog.btrim(r.room_number)) =
              pg_catalog.lower(pg_catalog.btrim(v_ticket.room_number))
        LIMIT 1;
    END IF;
  END IF;

  IF v_room.id IS NULL THEN
    access_state := 'room_unlinked';
    RETURN NEXT; RETURN;
  END IF;
  room_id := v_room.id;
  room_number := v_room.room_number;
  room_type := coalesce(v_room.room_category,v_room.room_type,v_room.room_name);
  v_meta := coalesce(v_room.pms_metadata,'{}'::jsonb);
  v_sync_ok := v_meta->>'pmsSyncDate' = v_today::text
      AND v_room.updated_at >= pg_catalog.now() - interval '12 hours';
  v_occupied := v_meta->>'occupiedToday' = 'true';
  v_arrival := v_meta->>'arrivalToday' = 'true';

  v_departure := v_meta->>'departureDate';
  IF v_departure ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}
    BEGIN checkout_date := v_departure::date;
    EXCEPTION WHEN others THEN checkout_date := NULL;
    END;
  END IF;
  IF checkout_date IS NULL AND v_meta->>'scheduledDepartureToday' = 'true' THEN
    checkout_date := v_today;
  END IF;
  IF (v_meta->>'departureTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    expected_checkout_time := v_meta->>'departureTime';
  END IF;
  BEGIN
    v_out_at := nullif(v_meta->>'checkedOutAt','')::timestamptz;
  EXCEPTION WHEN others THEN v_out_at := NULL;
  END;
  IF v_out_at IS NULL THEN v_out_at := v_room.checkout_time; END IF;
  checked_out := v_sync_ok AND v_meta->>'checkedOutToday' = 'true'
    AND v_out_at IS NOT NULL
    AND (v_out_at AT TIME ZONE 'Europe/Budapest')::date = v_today;
  checked_out_at := CASE WHEN checked_out THEN v_out_at ELSE NULL END;

  IF checkout_date = v_today OR v_room.is_checkout_room THEN
    stay_kind := 'checkout';
  ELSIF v_occupied OR v_meta->>'pmsOccupancyStatus' = 'stayover' THEN
    stay_kind := 'stayover';
  ELSIF v_meta->>'occupiedToday' = 'false' THEN
    stay_kind := 'vacant';
  END IF;

  IF NOT v_sync_ok OR v_arrival THEN
    -- A same-day arrival or old PMS snapshot can invalidate access evidence.
    access_state := 'status_unverified';
  ELSIF checked_out THEN
    access_state := 'ready_to_fix';
  ELSIF stay_kind = 'checkout' THEN
    access_state := 'waiting_for_checkout';
  ELSIF stay_kind = 'stayover' THEN
    access_state := 'consent_required';
  ELSIF stay_kind = 'vacant' THEN
    access_state := 'ready_to_fix';
  ELSE
    access_state := 'status_unverified';
  END IF;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_maintenance_room_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_maintenance_room_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_maintenance_ticket_with_access(
  p_ticket_id uuid, p_expected_updated_at timestamptz,
  p_access_confirmation text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_access record;
  v_confirmation text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_access_confirmation,'')));
  v_tenant text;
BEGIN
  -- Lock before evaluating the access guard and updating the ticket.
  PERFORM 1 FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  SELECT * INTO v_access FROM public.get_maintenance_room_access(p_ticket_id);
  IF v_access.access_state IN ('waiting_for_checkout','consent_required',
       'status_unverified','room_unlinked')
     AND v_confirmation NOT IN ('guest_permission','guest_out') THEN
    RAISE EXCEPTION 'Guest or PMS room status requires an access check. Confirm permission or that the room is accessible.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public.work_maintenance_ticket(
    p_ticket_id,'start',NULL,p_expected_updated_at,NULL,NULL);
  IF v_access.applies THEN
    SELECT organization_slug INTO v_tenant FROM public.tickets WHERE id=p_ticket_id;
    INSERT INTO public.comments(ticket_id,user_id,organization_slug,content)
    VALUES(p_ticket_id,auth.uid(),v_tenant,
      '[Maintenance access] ' ||
      CASE WHEN v_access.access_state='ready_to_fix'
          THEN 'PMS room status checked: ready to fix (physical presence not independently verified).'
        WHEN v_confirmation='guest_permission' THEN 'Technician confirmed guest permission before entry.'
        ELSE 'Technician confirmed room accessible before entry.' END);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.start_maintenance_ticket_with_access(uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_maintenance_ticket_with_access(uuid,timestamptz,text) TO authenticated;
 THEN
    BEGIN checkout_date := v_departure::date;
    EXCEPTION WHEN others THEN checkout_date := NULL;
    END;
  END IF;
  IF checkout_date IS NULL AND v_meta->>'scheduledDepartureToday' = 'true' THEN
    checkout_date := v_today;
  END IF;
  IF (v_meta->>'departureTime') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    expected_checkout_time := v_meta->>'departureTime';
  END IF;
  BEGIN
    v_out_at := nullif(v_meta->>'checkedOutAt','')::timestamptz;
  EXCEPTION WHEN others THEN v_out_at := NULL;
  END;
  IF v_out_at IS NULL THEN v_out_at := v_room.checkout_time; END IF;
  checked_out := v_sync_ok AND v_meta->>'checkedOutToday' = 'true'
    AND v_out_at IS NOT NULL
    AND (v_out_at AT TIME ZONE 'Europe/Budapest')::date = v_today;
  checked_out_at := CASE WHEN checked_out THEN v_out_at ELSE NULL END;

  IF checkout_date = v_today OR v_room.is_checkout_room THEN
    stay_kind := 'checkout';
  ELSIF v_occupied OR v_meta->>'pmsOccupancyStatus' = 'stayover' THEN
    stay_kind := 'stayover';
  ELSIF v_meta->>'occupiedToday' = 'false' THEN
    stay_kind := 'vacant';
  END IF;

  IF NOT v_sync_ok OR v_arrival THEN
    -- A same-day arrival or old PMS snapshot can invalidate access evidence.
    access_state := 'status_unverified';
  ELSIF checked_out THEN
    access_state := 'ready_to_fix';
  ELSIF stay_kind = 'checkout' THEN
    access_state := 'waiting_for_checkout';
  ELSIF stay_kind = 'stayover' THEN
    access_state := 'consent_required';
  ELSIF stay_kind = 'vacant' THEN
    access_state := 'ready_to_fix';
  ELSE
    access_state := 'status_unverified';
  END IF;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_maintenance_room_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_maintenance_room_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_maintenance_ticket_with_access(
  p_ticket_id uuid, p_expected_updated_at timestamptz,
  p_access_confirmation text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_access record;
  v_confirmation text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_access_confirmation,'')));
  v_tenant text;
BEGIN
  -- Lock before evaluating the access guard and updating the ticket.
  PERFORM 1 FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  SELECT * INTO v_access FROM public.get_maintenance_room_access(p_ticket_id);
  IF v_access.access_state IN ('waiting_for_checkout','consent_required',
       'status_unverified','room_unlinked')
     AND v_confirmation NOT IN ('guest_permission','guest_out') THEN
    RAISE EXCEPTION 'Guest or PMS room status requires an access check. Confirm permission or that the room is accessible.'
      USING ERRCODE = '22023';
  END IF;
  PERFORM public.work_maintenance_ticket(
    p_ticket_id,'start',NULL,p_expected_updated_at,NULL,NULL);
  IF v_access.applies THEN
    SELECT organization_slug INTO v_tenant FROM public.tickets WHERE id=p_ticket_id;
    INSERT INTO public.comments(ticket_id,user_id,organization_slug,content)
    VALUES(p_ticket_id,auth.uid(),v_tenant,
      '[Maintenance access] ' ||
      CASE WHEN v_access.access_state='ready_to_fix'
          THEN 'PMS room status checked: ready to fix (physical presence not independently verified).'
        WHEN v_confirmation='guest_permission' THEN 'Technician confirmed guest permission before entry.'
        ELSE 'Technician confirmed room accessible before entry.' END);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.start_maintenance_ticket_with_access(uuid,timestamptz,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_maintenance_ticket_with_access(uuid,timestamptz,text) TO authenticated;
