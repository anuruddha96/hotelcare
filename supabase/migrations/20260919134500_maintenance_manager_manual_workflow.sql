-- A manager must be able to record a repair carried out without an assigned
-- maintenance staff member. Keep authorization on the server and every state
-- change plus its history in the same database transaction.
CREATE OR REPLACE FUNCTION public.manage_maintenance_ticket(
  p_ticket_id uuid,
  p_action text,
  p_note text,
  p_expected_updated_at timestamptz,
  p_sla_breach_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_sla_reason text := btrim(coalesce(p_sla_breach_reason, ''));
  v_hotel_match boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage maintenance tickets' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_user FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR v_user.role::text NOT IN (
    'admin', 'manager', 'top_management', 'top_management_manager',
    'housekeeping_manager', 'maintenance_manager', 'reception_manager',
    'supervisor'
  ) THEN
    RAISE EXCEPTION 'You cannot manage maintenance tickets' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.department IS DISTINCT FROM 'maintenance' THEN
    RAISE EXCEPTION 'Maintenance ticket not found' USING ERRCODE = '22023';
  END IF;

  -- Never grant cross-organisation access, including to top managers or admins.
  -- Compare both canonical hotel IDs and legacy display names (SLNT included).
  SELECT EXISTS (
    SELECT 1 FROM public.hotel_configurations h
    WHERE v_user.assigned_hotel IN (h.hotel_id, h.hotel_name)
      AND v_ticket.hotel IN (h.hotel_id, h.hotel_name)
  ) OR (
    v_user.assigned_hotel IS NOT NULL AND v_ticket.hotel IS NOT NULL
    AND public.get_hotel_name_from_id(v_user.assigned_hotel)
        = public.get_hotel_name_from_id(v_ticket.hotel)
  ) INTO v_hotel_match;

  IF v_user.organization_slug IS NULL
     OR v_ticket.organization_slug IS DISTINCT FROM v_user.organization_slug
     OR NOT coalesce(v_hotel_match, false) THEN
    RAISE EXCEPTION 'Ticket does not belong to your selected hotel' USING ERRCODE = '42501';
  END IF;

  IF v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'This ticket was updated by another user. Refresh and try again.' USING ERRCODE = '40001';
  END IF;

  IF v_action NOT IN ('start', 'hold', 'resume', 'resolve', 'reopen') THEN
    RAISE EXCEPTION 'Unsupported maintenance action' USING ERRCODE = '22023';
  END IF;

  IF v_action IN ('hold', 'resolve', 'reopen') AND length(v_note) < 3 THEN
    RAISE EXCEPTION 'Add an explanation (at least 3 characters)' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'reopen' AND v_ticket.status <> 'completed' THEN
    RAISE EXCEPTION 'Only completed tickets can be reopened' USING ERRCODE = '22023';
  ELSIF v_action <> 'reopen' AND v_ticket.status = 'completed' THEN
    RAISE EXCEPTION 'Reopen this ticket before making another change' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'resolve' AND v_ticket.sla_due_date < now() AND length(v_sla_reason) < 3
     AND coalesce(v_ticket.sla_breach_reason, '') = '' THEN
    RAISE EXCEPTION 'SLA deadline passed: enter the reason for the delay' USING ERRCODE = '22023';
  END IF;

  -- Existing Gozsdu trigger restricts top_management_manager to approvals.
  -- This transaction-local marker is set only after the above permission,
  -- hotel, action and concurrency checks succeed; it never persists.
  PERFORM pg_catalog.set_config('hotelcare.manual_maintenance_workflow', 'validated', true);

  IF v_action = 'start' THEN
    UPDATE public.tickets SET status = 'in_progress', on_hold = false, hold_reason = NULL
    WHERE id = v_ticket.id;
  ELSIF v_action = 'hold' THEN
    UPDATE public.tickets SET status = 'in_progress', on_hold = true, hold_reason = v_note
    WHERE id = v_ticket.id;
  ELSIF v_action = 'resume' THEN
    UPDATE public.tickets SET status = 'in_progress', on_hold = false, hold_reason = NULL
    WHERE id = v_ticket.id;
  ELSIF v_action = 'resolve' THEN
    UPDATE public.tickets SET status = 'completed', resolution_text = v_note,
      closed_by = auth.uid(), closed_at = now(), on_hold = false, hold_reason = NULL,
      pending_supervisor_approval = false, supervisor_approved = true,
      supervisor_approved_at = now(), supervisor_approved_by = auth.uid(),
      sla_breach_reason = CASE WHEN length(v_sla_reason) > 0 THEN v_sla_reason ELSE sla_breach_reason END
    WHERE id = v_ticket.id;
  ELSE
    UPDATE public.tickets SET status = 'open', on_hold = false, hold_reason = NULL,
      pending_supervisor_approval = false, supervisor_approved = false,
      supervisor_approved_at = NULL, supervisor_approved_by = NULL,
      closed_by = NULL, closed_at = NULL, resolution_text = NULL,
      sla_breach_reason = NULL
    WHERE id = v_ticket.id;
  END IF;

  PERFORM pg_catalog.set_config('hotelcare.manual_maintenance_workflow', '', true);

  INSERT INTO public.comments (ticket_id, user_id, organization_slug, content)
  VALUES (v_ticket.id, auth.uid(), v_ticket.organization_slug,
    '[Manager maintenance action: ' || v_action || '] ' ||
    CASE WHEN v_action = 'reopen' AND v_ticket.resolution_text IS NOT NULL
      THEN 'Previous resolution: ' || left(v_ticket.resolution_text, 1000) || '. ' ELSE '' END ||
    CASE WHEN length(v_note) > 0 THEN left(v_note, 2000) ELSE 'Status updated.' END ||
    CASE WHEN length(v_sla_reason) > 0 THEN ' SLA delay: ' || left(v_sla_reason, 1000) ELSE '' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_maintenance_ticket(uuid,text,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_maintenance_ticket(uuid,text,text,timestamptz,text) TO authenticated;

-- Retain the strict legacy approval guard while allowing only the vetted
-- server-side manual workflow to update a Gozsdu top-manager ticket.
CREATE OR REPLACE FUNCTION public.guard_gozsdu_top_manager_ticket_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.hotel = 'gozsdu-court'
     AND OLD.organization_slug = 'rdhotels'
     AND OLD.department = 'maintenance'
     AND public.get_user_role(auth.uid())::text = 'top_management_manager' THEN
    IF pg_catalog.current_setting('hotelcare.manual_maintenance_workflow', true) = 'validated'
       AND NEW.hotel = OLD.hotel
       AND NEW.organization_slug = OLD.organization_slug
       AND NEW.department = OLD.department
       AND (to_jsonb(NEW) - ARRAY[
         'status','on_hold','hold_reason','resolution_text','closed_at','closed_by',
         'pending_supervisor_approval','supervisor_approved','supervisor_approved_at',
         'supervisor_approved_by','sla_breach_reason','updated_at'
       ]) IS NOT DISTINCT FROM (to_jsonb(OLD) - ARRAY[
         'status','on_hold','hold_reason','resolution_text','closed_at','closed_by',
         'pending_supervisor_approval','supervisor_approved','supervisor_approved_at',
         'supervisor_approved_by','sla_breach_reason','updated_at'
       ]) THEN
      RETURN NEW;
    END IF;
    IF OLD.pending_supervisor_approval IS NOT TRUE
       OR NEW.pending_supervisor_approval IS NOT FALSE
       OR NEW.supervisor_approved IS NOT TRUE
       OR NEW.supervisor_approved_by IS DISTINCT FROM auth.uid()
       OR NEW.closed_by IS DISTINCT FROM auth.uid()
       OR NEW.status::text <> 'completed'
       OR (to_jsonb(NEW) - ARRAY[
         'status','pending_supervisor_approval','supervisor_approved',
         'supervisor_approved_at','supervisor_approved_by','closed_at','closed_by','updated_at'
       ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
         'status','pending_supervisor_approval','supervisor_approved',
         'supervisor_approved_at','supervisor_approved_by','closed_at','closed_by','updated_at'
       ]) THEN
      RAISE EXCEPTION 'Only maintenance approval or authorized manual management is permitted for this Gozsdu manager role';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;