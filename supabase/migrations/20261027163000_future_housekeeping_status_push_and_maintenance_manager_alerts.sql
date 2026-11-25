-- Additional strictly future-only operational Web Push events.
-- Maintenance creation and high-priority holds also notify hotel managers, including
-- properties without an assigned maintenance user. Never replay prior events.
CREATE OR REPLACE FUNCTION public.hotelcare_send_maintenance_activity_push(
  _ticket_id uuid,
  _kind text,
  _actor_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _ticket public.tickets%ROWTYPE;
  _canonical_id text;
  _canonical_name text;
  _recipients uuid[];
  _label text;
  _title text;
  _body text;
  _org text;
BEGIN
  -- Only supported events; never turn older ticket data into a backfill.
  IF _kind NOT IN (
    'created', 'assigned', 'in_progress', 'completed', 'reopened',
    'approval_requested', 'approved', 'on_hold', 'resumed',
    'priority_changed', 'comment'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT t.* INTO _ticket FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND OR _ticket.department IS DISTINCT FROM 'maintenance'
      OR _ticket.source = 'housekeeping_legacy_backfill' THEN
    RETURN NULL;
  END IF;

  _org := COALESCE(NULLIF(_ticket.organization_slug, ''), 'rdhotels');
  SELECT hc.hotel_id, hc.hotel_name INTO _canonical_id, _canonical_name
  FROM public.hotel_configurations hc
  WHERE lower(hc.hotel_id) = lower(_ticket.hotel)
     OR lower(hc.hotel_name) = lower(_ticket.hotel)
  ORDER BY CASE WHEN lower(hc.hotel_id) = lower(_ticket.hotel) THEN 0 ELSE 1 END
  LIMIT 1;

  -- Maintenance team at this property, plus directly involved users.
  -- Supervisors only for approval/completion; never broadcast to unrelated hotels.
  SELECT COALESCE(array_agg(DISTINCT p.id), '{}'::uuid[]) INTO _recipients
  FROM public.profiles p
  WHERE p.deleted_at IS NULL
    AND p.organization_slug = _org
    AND p.id IS DISTINCT FROM _actor_id
    AND (
      p.id = _ticket.assigned_to
      OR (_kind <> 'created' AND p.id = _ticket.created_by)
      OR (
        p.role::text = 'maintenance'
        AND (
          p.assigned_hotel = ANY(ARRAY[_ticket.hotel, _canonical_id, _canonical_name])
          OR p.hotel_id = ANY(ARRAY[_ticket.hotel, _canonical_id, _canonical_name])
        )
      )
      OR (
        _kind IN ('created', 'approval_requested', 'completed', 'on_hold', 'priority_changed')
        AND p.role::text IN ('manager', 'housekeeping_manager', 'maintenance_manager', 'supervisor')
        AND (
          p.assigned_hotel = ANY(ARRAY[_ticket.hotel, _canonical_id, _canonical_name])
          OR p.hotel_id = ANY(ARRAY[_ticket.hotel, _canonical_id, _canonical_name])
        )
      )
    );

  IF COALESCE(array_length(_recipients, 1), 0) = 0 THEN
    RETURN NULL;
  END IF;

  _label := CASE _kind
    WHEN 'created' THEN 'New maintenance request'
    WHEN 'assigned' THEN 'Maintenance assignment updated'
    WHEN 'in_progress' THEN 'Maintenance work started'
    WHEN 'completed' THEN 'Maintenance ticket completed'
    WHEN 'reopened' THEN 'Maintenance ticket reopened'
    WHEN 'approval_requested' THEN 'Repair awaiting approval'
    WHEN 'approved' THEN 'Maintenance repair approved'
    WHEN 'on_hold' THEN 'Maintenance work on hold'
    WHEN 'resumed' THEN 'Maintenance work resumed'
    WHEN 'priority_changed' THEN 'Maintenance priority changed'
    WHEN 'comment' THEN 'New maintenance comment'
  END;

  _title := _label;
  _body := left(
    COALESCE(NULLIF(_ticket.ticket_number,''),'Maintenance') ||
    CASE WHEN _ticket.room_number IS NOT NULL AND _ticket.room_number <> ''
      THEN ' · Room ' || _ticket.room_number ELSE '' END ||
    ' · ' || COALESCE(NULLIF(_ticket.hotel,''),'Hotel') ||
    CASE WHEN _kind = 'priority_changed' THEN ' · ' || initcap(_ticket.priority::text) || ' priority'
      ELSE '' END,
    180
  );

  RETURN public.hotelcare_dispatch_push(
    _recipients,
    _title,
    _body,
    '/' || _org || '?tab=tickets&maintenanceIssue=' || _ticket.id::text,
    'maintenance-ticket-' || _ticket.id::text,
    'maintenance_' || _kind,
    jsonb_build_object(
      'ticketId', _ticket.id,
      'hotel', _ticket.hotel,
      'status', _ticket.status::text,
      'pendingSupervisorApproval', _ticket.pending_supervisor_approval,
      'event', _kind,
      'occurredAt', clock_timestamp()
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'HotelCare maintenance Web Push dispatch failed for ticket %: %', _ticket_id, SQLERRM;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.hotelcare_notify_future_housekeeping_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _kind text;
  _room record;
  _canonical_id text;
  _canonical_name text;
  _org text;
  _recipients uuid[];
  _title text;
BEGIN
  -- No migration backfill: this runs only for a new actionable transition.
  -- Suppress incidental edits to obsolete historical room assignments.
  IF NEW.assignment_date < (now() AT TIME ZONE 'Europe/Budapest')::date - 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.supervisor_approved IS TRUE
      AND OLD.supervisor_approved IS DISTINCT FROM TRUE
      AND NEW.assigned_to IS NOT NULL THEN
    _kind := 'cleaning_approved';
  ELSIF OLD.status::text = 'completed'
      AND NEW.status::text = 'in_progress'
      AND NEW.assigned_to IS NOT NULL THEN
    _kind := 'cleaning_returned';
  ELSIF NEW.status::text = 'completed'
      AND OLD.status::text IS DISTINCT FROM 'completed'
      AND NEW.supervisor_approved IS DISTINCT FROM TRUE THEN
    _kind := 'cleaning_review_required';
  ELSE
    RETURN NEW;
  END IF;

  SELECT r.room_number, r.hotel, r.organization_slug
    INTO _room
  FROM public.rooms r
  WHERE r.id = NEW.room_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  _org := COALESCE(NULLIF(NEW.organization_slug, ''), NULLIF(_room.organization_slug, ''), 'rdhotels');
  SELECT hc.hotel_id, hc.hotel_name INTO _canonical_id, _canonical_name
  FROM public.hotel_configurations hc
  WHERE lower(hc.hotel_id) = lower(_room.hotel)
     OR lower(hc.hotel_name) = lower(_room.hotel)
  ORDER BY CASE WHEN lower(hc.hotel_id) = lower(_room.hotel) THEN 0 ELSE 1 END
  LIMIT 1;

  IF _kind = 'cleaning_review_required' THEN
    SELECT COALESCE(array_agg(DISTINCT p.id), '{}'::uuid[]) INTO _recipients
    FROM public.profiles p
    WHERE p.deleted_at IS NULL
      AND p.organization_slug = _org
      AND p.id IS DISTINCT FROM auth.uid()
      AND p.role::text IN ('manager', 'housekeeping_manager', 'supervisor')
      AND (
        p.assigned_hotel = ANY(ARRAY[_room.hotel, _canonical_id, _canonical_name])
        OR p.hotel_id = ANY(ARRAY[_room.hotel, _canonical_id, _canonical_name])
      );
  ELSE
    SELECT COALESCE(array_agg(p.id), '{}'::uuid[]) INTO _recipients
    FROM public.profiles p
    WHERE p.id = NEW.assigned_to
      AND p.deleted_at IS NULL
      AND p.organization_slug = _org
      AND p.id IS DISTINCT FROM auth.uid();
  END IF;

  IF COALESCE(array_length(_recipients, 1), 0) = 0 THEN RETURN NEW; END IF;

  _title := CASE _kind
    WHEN 'cleaning_review_required' THEN 'Room cleaning awaiting approval'
    WHEN 'cleaning_approved' THEN 'Your cleaned room was approved'
    WHEN 'cleaning_returned' THEN 'Room returned for cleaning'
  END;

  PERFORM public.hotelcare_dispatch_push(
    _recipients,
    _title,
    left('Room ' || COALESCE(_room.room_number, '?') || ' · ' || COALESCE(_canonical_name, _room.hotel), 180),
    '/' || _org || '?tab=housekeeping&hkAssignment=' || NEW.id::text || '&hkRoom=' || NEW.room_id::text,
    'housekeeping-status-' || NEW.id::text,
    _kind,
    jsonb_build_object(
      'assignmentId', NEW.id,
      'roomId', NEW.room_id,
      'roomNumber', _room.room_number,
      'hotel', _room.hotel,
      'workDate', NEW.assignment_date,
      'event', _kind,
      'occurredAt', clock_timestamp()
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'HotelCare housekeeping status push failed for assignment %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hotelcare_future_housekeeping_workflow_push ON public.room_assignments;
CREATE TRIGGER hotelcare_future_housekeeping_workflow_push
AFTER UPDATE OF status, supervisor_approved
ON public.room_assignments
FOR EACH ROW
EXECUTE FUNCTION public.hotelcare_notify_future_housekeeping_workflow();

REVOKE ALL ON FUNCTION public.hotelcare_notify_future_housekeeping_workflow() FROM PUBLIC, anon, authenticated;
