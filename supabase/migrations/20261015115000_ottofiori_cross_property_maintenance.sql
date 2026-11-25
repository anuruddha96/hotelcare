-- Exception only for RD Hotels / Hotel Ottofiori.
-- Cross-property maintenance is by EXPLICIT manager assignment, never inherited
-- permission to browse Ottofiori rooms, other tickets, or other organizations.

CREATE OR REPLACE FUNCTION public.can_assign_ottofiori_maintenance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL
     AND p.organization_slug = 'rdhotels'
     AND (
       p.role::text = 'top_management'
       OR (p.role::text IN ('manager','top_management_manager')
           AND public.get_hotel_name_from_id(p.assigned_hotel) = 'Hotel Ottofiori')
     )
 );
$$;
REVOKE ALL ON FUNCTION public.can_assign_ottofiori_maintenance() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_assign_ottofiori_maintenance() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_ottofiori_maintenance_candidates()
RETURNS TABLE(id uuid, full_name text, assigned_hotel text, role text, is_signed_in boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id,p.full_name,p.assigned_hotel,p.role::text,
    EXISTS(
      SELECT 1 FROM public.staff_attendance a
      WHERE a.user_id=p.id AND a.work_date=(now() AT TIME ZONE 'Europe/Budapest')::date
        AND a.status='checked_in'
    ) AS is_signed_in
  FROM public.profiles p
  WHERE public.can_assign_ottofiori_maintenance()
    AND p.organization_slug='rdhotels'
    AND p.role::text IN ('maintenance','maintenance_manager')
    AND p.deleted_at IS NULL
    AND p.assigned_hotel IS NOT NULL
  ORDER BY p.full_name,p.assigned_hotel;
$$;
REVOKE ALL ON FUNCTION public.get_ottofiori_maintenance_candidates() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_ottofiori_maintenance_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_ottofiori_maintenance_ticket(
  p_ticket_id uuid,
  p_assignee_id uuid,
  p_expected_updated_at timestamptz
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
 v_ticket public.tickets%ROWTYPE;
 v_staff public.profiles%ROWTYPE;
BEGIN
 IF NOT public.can_assign_ottofiori_maintenance() THEN
   RAISE EXCEPTION 'Only this hotel manager or top management can assign an Ottofiori repair.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
 IF NOT FOUND OR v_ticket.organization_slug <> 'rdhotels'
    OR v_ticket.department <> 'maintenance'
    OR public.get_hotel_name_from_id(v_ticket.hotel) <> 'Hotel Ottofiori'
 THEN RAISE EXCEPTION 'Only Hotel Ottofiori maintenance tickets can be assigned here.' USING ERRCODE='42501';
 END IF;
 IF v_ticket.status='completed'::public.ticket_status OR coalesce(v_ticket.pending_supervisor_approval,false) THEN
   RAISE EXCEPTION 'This repair is completed or waiting for approval.' USING ERRCODE='22023';
 END IF;
 IF p_expected_updated_at IS NULL OR v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
   RAISE EXCEPTION 'This ticket changed. Refresh it and try again.' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO v_staff FROM public.profiles
 WHERE id=p_assignee_id AND organization_slug='rdhotels'
   AND deleted_at IS NULL
   AND role::text IN ('maintenance','maintenance_manager')
   AND assigned_hotel IS NOT NULL;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Select an active RD Hotels maintenance employee.' USING ERRCODE='42501';
 END IF;
 IF v_ticket.assigned_to IS DISTINCT FROM v_staff.id THEN
   UPDATE public.tickets
     SET assigned_to=v_staff.id, assignment_method='manual', updated_at=now()
     WHERE id=v_ticket.id;
   INSERT INTO public.comments(ticket_id,user_id,organization_slug,content)
     VALUES(v_ticket.id,auth.uid(),v_ticket.organization_slug,
       '[Maintenance assignment] '||coalesce(v_staff.full_name,'Maintenance team')||
       ' assigned to Hotel Ottofiori repair by a hotel manager.');
 END IF;
 RETURN coalesce(v_staff.full_name,'Maintenance team');
END;
$$;
REVOKE ALL ON FUNCTION public.assign_ottofiori_maintenance_ticket(uuid,uuid,timestamptz) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.assign_ottofiori_maintenance_ticket(uuid,uuid,timestamptz) TO authenticated;

-- Other hotels keep their original access rules.
DROP POLICY IF EXISTS "Explicit Ottofiori maintenance assignee can read their issue" ON public.tickets;
CREATE POLICY "Explicit Ottofiori maintenance assignee can read their issue"
 ON public.tickets FOR SELECT TO authenticated
 USING (
   organization_slug='rdhotels'
   AND department='maintenance'
   AND public.get_hotel_name_from_id(hotel)='Hotel Ottofiori'
   AND assigned_to=auth.uid()
   AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id=auth.uid() AND p.deleted_at IS NULL
        AND p.organization_slug='rdhotels'
        AND p.role::text IN ('maintenance','maintenance_manager')
   )
 );

-- Keep photo/comment RLS aligned with explicit assignment for this one issue.
CREATE OR REPLACE FUNCTION public.user_can_view_ticket(ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tickets t
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE t.id = ticket_id
      AND t.organization_slug = p.organization_slug
      AND (
        (p.deleted_at IS NULL
          AND p.organization_slug = 'rdhotels'
          AND p.role::text IN ('maintenance','maintenance_manager')
          AND t.department = 'maintenance'
          AND t.organization_slug = 'rdhotels'
          AND public.get_hotel_name_from_id(t.hotel) = 'Hotel Ottofiori'
          AND t.assigned_to = p.id)
        OR EXISTS (
        SELECT 1
        FROM public.get_user_access_config(p.role) cfg
        WHERE cfg.can_manage_all = true
           OR (
             (cfg.department = 'all'
               OR cfg.department = t.department
               OR (cfg.department = 'front_office' AND t.department = 'reception'))
             AND (
               cfg.access_scope = 'all_hotels'
               OR (cfg.access_scope = 'hotel_only'
                 AND p.assigned_hotel IS NOT NULL
                 AND public.get_hotel_name_from_id(p.assigned_hotel) = public.get_hotel_name_from_id(t.hotel))
               OR (cfg.access_scope = 'assigned_and_created'
                 AND (
                   t.assigned_to = p.id OR t.created_by = p.id
                   OR (p.assigned_hotel IS NOT NULL
                     AND public.get_hotel_name_from_id(p.assigned_hotel) = public.get_hotel_name_from_id(t.hotel)
                     AND cfg.department = t.department)
                 ))
             )
           )
      )
      )
  );
$function$;


-- Worker update + physical room-access checks must agree with the ticket read rule.
CREATE OR REPLACE FUNCTION public.get_maintenance_room_access(p_ticket_id uuid)
 RETURNS TABLE(applies boolean, room_id uuid, room_number text, room_type text, stay_kind text, checkout_date date, expected_checkout_time text, checked_out boolean, checked_out_at timestamp with time zone, access_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
    OR (
       public.get_hotel_name_from_id(v_user.assigned_hotel)
         IS DISTINCT FROM public.get_hotel_name_from_id(v_ticket.hotel)
       AND NOT (
         v_ticket.organization_slug = 'rdhotels'
         AND public.get_hotel_name_from_id(v_ticket.hotel) = 'Hotel Ottofiori'
         AND v_ticket.assigned_to = v_user.id
       )
     ) THEN
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
  IF v_departure ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
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

CREATE OR REPLACE FUNCTION public.work_maintenance_ticket(p_ticket_id uuid, p_action text, p_note text, p_expected_updated_at timestamp with time zone, p_hold_reason text DEFAULT NULL::text, p_completion_photo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_note text := pg_catalog.btrim(coalesce(p_note, ''));
  v_hold_reason text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_hold_reason, '')));
  v_completion_photo text := pg_catalog.btrim(coalesce(p_completion_photo, ''));
  v_assignee_name text;
  v_assist_prefix text := '';
  v_history text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to update maintenance tickets' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_user
  FROM public.profiles
  WHERE id = auth.uid()
    AND deleted_at IS NULL;

  IF NOT FOUND OR v_user.role::text NOT IN ('maintenance', 'maintenance_manager') THEN
    RAISE EXCEPTION 'Only maintenance team members can use this workflow' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket
  FROM public.tickets
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF NOT FOUND OR v_ticket.department IS DISTINCT FROM 'maintenance' THEN
    RAISE EXCEPTION 'Maintenance ticket not found' USING ERRCODE = '22023';
  END IF;

  IF v_user.organization_slug IS NULL
     OR v_ticket.organization_slug IS DISTINCT FROM v_user.organization_slug
     OR v_user.assigned_hotel IS NULL
     OR v_ticket.hotel IS NULL
     OR (
       public.get_hotel_name_from_id(v_user.assigned_hotel)
         IS DISTINCT FROM public.get_hotel_name_from_id(v_ticket.hotel)
       AND NOT (
         v_ticket.organization_slug = 'rdhotels'
         AND public.get_hotel_name_from_id(v_ticket.hotel) = 'Hotel Ottofiori'
         AND v_ticket.assigned_to = v_user.id
       )
     ) THEN
    RAISE EXCEPTION 'Ticket is outside your assigned property' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL
     OR v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'This ticket was updated by another user. Refresh and try again.' USING ERRCODE = 'P0001', HINT = 'Refresh the ticket before retrying.';
  END IF;

  IF v_action NOT IN ('start', 'hold', 'resume', 'submit') THEN
    RAISE EXCEPTION 'Unsupported maintenance action' USING ERRCODE = '22023';
  END IF;

  IF v_ticket.status = 'completed'::public.ticket_status THEN
    RAISE EXCEPTION 'Completed tickets cannot be changed from the worker view' USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_ticket.pending_supervisor_approval, false) THEN
    RAISE EXCEPTION 'This ticket is already awaiting supervisor approval' USING ERRCODE = '22023';
  END IF;

  IF v_ticket.assigned_to IS NOT NULL THEN
    SELECT full_name INTO v_assignee_name
    FROM public.profiles
    WHERE id = v_ticket.assigned_to;

    IF v_ticket.assigned_to IS DISTINCT FROM auth.uid() THEN
      v_assist_prefix := 'Assisting ticket assigned to ' ||
        coalesce(v_assignee_name, 'another maintenance teammate') || '. ';
    END IF;
  END IF;

  IF v_action = 'start' THEN
    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        on_hold = false,
        hold_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;
    v_history := v_assist_prefix || 'Work started.';

  ELSIF v_action = 'hold' THEN
    IF v_hold_reason NOT IN (
      'parts_pending', 'purchase_in_progress', 'waiting_for_access',
      'waiting_for_approval', 'external_contractor', 'other'
    ) THEN
      RAISE EXCEPTION 'Choose a valid pending reason' USING ERRCODE = '22023';
    END IF;

    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        on_hold = true,
        hold_reason = v_hold_reason,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;
    v_history := v_assist_prefix || 'Marked pending: ' || v_hold_reason ||
      CASE WHEN pg_catalog.length(v_note) > 0
        THEN ' — ' || pg_catalog.left(v_note, 1500)
        ELSE ''
      END;

  ELSIF v_action = 'resume' THEN
    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        on_hold = false,
        hold_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;
    v_history := v_assist_prefix || 'Work resumed.';

  ELSE
    IF v_ticket.status IS DISTINCT FROM 'in_progress'::public.ticket_status
       OR coalesce(v_ticket.on_hold, false) THEN
      RAISE EXCEPTION 'Start or resume the ticket before submitting completion' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.length(v_note) < 3 THEN
      RAISE EXCEPTION 'Describe the completed repair' USING ERRCODE = '22023';
    END IF;

    UPDATE public.tickets
    SET status = 'in_progress'::public.ticket_status,
        resolution_text = pg_catalog.left(v_note, 4000),
        completion_photos = CASE
          WHEN pg_catalog.length(v_completion_photo) > 0
            THEN coalesce(v_ticket.completion_photos, ARRAY[]::text[]) ||
                 ARRAY[pg_catalog.left(v_completion_photo, 1000)]
          ELSE coalesce(v_ticket.completion_photos, ARRAY[]::text[])
        END,
        pending_supervisor_approval = true,
        on_hold = false,
        hold_reason = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_ticket.id;

    v_history := v_assist_prefix || 'Completion submitted for supervisor approval: ' ||
      pg_catalog.left(v_note, 1800) ||
      CASE WHEN pg_catalog.length(v_completion_photo) > 0
        THEN ' Completion photo attached.'
        ELSE ' No completion photo attached.'
      END;
  END IF;

  INSERT INTO public.comments (ticket_id, user_id, organization_slug, content)
  VALUES (
    v_ticket.id,
    auth.uid(),
    v_ticket.organization_slug,
    '[Maintenance team action: ' || v_action || '] ' || v_history
  );
END;
$function$;


-- The old generic ticket UPDATE policy can be used by managers to change an
-- assignee directly. Enforce the cross-property rule in the database too,
-- including direct INSERT attempts. Normal same-property routing is unaffected.
CREATE OR REPLACE FUNCTION public.guard_ottofiori_cross_property_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
 v_new public.profiles%ROWTYPE;
 v_old public.profiles%ROWTYPE;
 v_new_cross boolean := false;
 v_old_cross boolean := false;
BEGIN
 IF NEW.organization_slug IS DISTINCT FROM 'rdhotels'
    OR NEW.department IS DISTINCT FROM 'maintenance'
    OR public.get_hotel_name_from_id(NEW.hotel) IS DISTINCT FROM 'Hotel Ottofiori'
 THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
   RETURN NEW;
 END IF;
 IF NEW.assigned_to IS NOT NULL THEN
   SELECT * INTO v_new FROM public.profiles WHERE id=NEW.assigned_to;
   IF v_new.id IS NULL OR v_new.organization_slug IS DISTINCT FROM 'rdhotels' THEN
     RAISE EXCEPTION 'Ottofiori assignee must belong to RD Hotels' USING ERRCODE='42501';
   END IF;
   v_new_cross := public.get_hotel_name_from_id(v_new.assigned_hotel)
      IS DISTINCT FROM 'Hotel Ottofiori';
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.assigned_to IS NOT NULL THEN
   SELECT * INTO v_old FROM public.profiles WHERE id=OLD.assigned_to;
   v_old_cross := v_old.id IS NOT NULL
     AND public.get_hotel_name_from_id(v_old.assigned_hotel)
       IS DISTINCT FROM 'Hotel Ottofiori';
 END IF;
 IF v_new_cross OR v_old_cross THEN
   IF v_new_cross AND (v_new.deleted_at IS NOT NULL
      OR v_new.role::text NOT IN ('maintenance','maintenance_manager')) THEN
     RAISE EXCEPTION 'Cross-property assignment requires an active maintenance employee' USING ERRCODE='42501';
   END IF;
   -- Server-side workers use a service-role token. A signed-in user must
   -- be an authorized Ottofiori manager, even if another RLS rule is broad.
   IF coalesce(auth.role(),'') <> 'service_role'
      AND NOT public.can_assign_ottofiori_maintenance() THEN
     RAISE EXCEPTION 'Only Hotel Ottofiori managers can change an external maintenance assignment' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_ottofiori_cross_property_assignment() FROM public,anon,authenticated;
DROP TRIGGER IF EXISTS guard_ottofiori_cross_property_ticket_assignment ON public.tickets;
CREATE TRIGGER guard_ottofiori_cross_property_ticket_assignment
 BEFORE INSERT OR UPDATE OF assigned_to ON public.tickets
 FOR EACH ROW EXECUTE FUNCTION public.guard_ottofiori_cross_property_assignment();
