-- HotelCare: future-only event-driven Web Push for maintenance tickets and new comments.
-- Existing tickets are never replayed or backfilled. This migration does not mutate ticket data.
-- Delivery remains opt-in and is executed through the existing authenticated push sender.

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
        _kind IN ('approval_requested', 'completed')
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

CREATE OR REPLACE FUNCTION public.hotelcare_notify_future_maintenance_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _kind text;
BEGIN
  IF NEW.department IS DISTINCT FROM 'maintenance'
     OR NEW.source = 'housekeeping_legacy_backfill' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Avoid accidental notifications for historical tickets inserted by imports.
    IF NEW.created_at < statement_timestamp() - interval '5 minutes' THEN
      RETURN NEW;
    END IF;
    _kind := 'created';
  ELSE
    -- An UPDATE to an old record is relevant only if its actionable state changes NOW.
    IF NEW.pending_supervisor_approval IS TRUE
       AND OLD.pending_supervisor_approval IS DISTINCT FROM TRUE THEN
      _kind := 'approval_requested';
    ELSIF NEW.supervisor_approved IS TRUE
       AND OLD.supervisor_approved IS DISTINCT FROM TRUE THEN
      _kind := 'approved';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      _kind := CASE NEW.status::text
        WHEN 'in_progress' THEN 'in_progress'
        WHEN 'completed' THEN 'completed'
        ELSE 'reopened'
      END;
    ELSIF NEW.on_hold IS TRUE AND OLD.on_hold IS DISTINCT FROM TRUE THEN
      _kind := 'on_hold';
    ELSIF NEW.on_hold IS FALSE AND OLD.on_hold IS TRUE THEN
      _kind := 'resumed';
    ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      _kind := 'assigned';
    ELSIF NEW.priority IS DISTINCT FROM OLD.priority THEN
      _kind := 'priority_changed';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.hotelcare_send_maintenance_activity_push(
    NEW.id, _kind, auth.uid()
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hotelcare_future_maintenance_push ON public.tickets;
CREATE TRIGGER hotelcare_future_maintenance_push
AFTER INSERT OR UPDATE OF
  status, assigned_to, priority, on_hold, hold_reason,
  pending_supervisor_approval, supervisor_approved
ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.hotelcare_notify_future_maintenance_ticket();

CREATE OR REPLACE FUNCTION public.hotelcare_notify_future_maintenance_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- INSERT-only. A migration does not reread historical comments.
  IF NEW.created_at < statement_timestamp() - interval '5 minutes' THEN
    RETURN NEW;
  END IF;
  PERFORM public.hotelcare_send_maintenance_activity_push(
    NEW.ticket_id, 'comment', NEW.user_id
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS hotelcare_future_maintenance_comment_push ON public.comments;
CREATE TRIGGER hotelcare_future_maintenance_comment_push
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.hotelcare_notify_future_maintenance_comment();

-- Trigger helpers are not public RPC endpoints.
REVOKE ALL ON FUNCTION public.hotelcare_send_maintenance_activity_push(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelcare_notify_future_maintenance_ticket() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hotelcare_notify_future_maintenance_comment() FROM PUBLIC, anon, authenticated;
