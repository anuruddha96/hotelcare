-- Source-only migration. Do not apply to production as part of a GitHub merge.
-- Reuse the existing manager-maintenance role/hotel checks; approvals must never
-- broaden SELECT access to unrelated employee profiles or another tenant's tickets.
CREATE OR REPLACE FUNCTION public.review_maintenance_completion(
  p_ticket_id uuid,
  p_decision text,
  p_note text,
  p_expected_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user public.profiles%ROWTYPE;
  v_ticket public.tickets%ROWTYPE;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_hotel_match boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to review maintenance' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_user FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR v_user.role::text NOT IN (
    'admin', 'manager', 'top_management', 'top_management_manager',
    'housekeeping_manager', 'maintenance_manager', 'reception_manager', 'supervisor'
  ) THEN
    RAISE EXCEPTION 'You cannot review maintenance work' USING ERRCODE = '42501';
  END IF;
  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid review decision' USING ERRCODE = '22023';
  END IF;
  IF length(v_note) > 2000 OR (v_decision = 'reject' AND length(v_note) < 3) THEN
    RAISE EXCEPTION 'A rejection reason of 3 to 2000 characters is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.department IS DISTINCT FROM 'maintenance' THEN
    RAISE EXCEPTION 'Maintenance ticket not found' USING ERRCODE = '22023';
  END IF;
  -- Verify tenant AND selected property. A role alone can never authorize a cross-hotel review.
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
  IF v_ticket.status IS DISTINCT FROM 'in_progress'
     OR v_ticket.pending_supervisor_approval IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Ticket is not awaiting maintenance approval' USING ERRCODE = '22023';
  END IF;
  IF v_ticket.assigned_to IS NOT NULL AND v_ticket.assigned_to = auth.uid() THEN
    RAISE EXCEPTION 'A worker cannot approve their own repair' USING ERRCODE = '42501';
  END IF;
  IF v_decision = 'approve' AND length(btrim(coalesce(v_ticket.resolution_text, ''))) < 3 THEN
    RAISE EXCEPTION 'Cannot approve a ticket without a repair description' USING ERRCODE = '22023';
  END IF;

  -- Existing Gozsdu top-management trigger permits this marker only inside
  -- server-validated transactions with an approved field allow-list.
  PERFORM pg_catalog.set_config('hotelcare.manual_maintenance_workflow', 'validated', true);
  IF v_decision = 'approve' THEN
    UPDATE public.tickets SET
      status = 'completed', pending_supervisor_approval = false,
      supervisor_approved = true, supervisor_approved_at = now(),
      supervisor_approved_by = auth.uid(), closed_by = auth.uid(), closed_at = now(),
      on_hold = false, hold_reason = NULL
    WHERE id = v_ticket.id;
  ELSE
    -- Keep immutable work evidence in the audit comment below before clearing
    -- a rejected resolution. Preserve original ticket and completion photos.
    UPDATE public.tickets SET
      status = 'in_progress', pending_supervisor_approval = false,
      supervisor_approved = false, supervisor_approved_at = NULL,
      supervisor_approved_by = NULL, closed_by = NULL, closed_at = NULL,
      resolution_text = NULL, on_hold = false, hold_reason = NULL
    WHERE id = v_ticket.id;
  END IF;
  PERFORM pg_catalog.set_config('hotelcare.manual_maintenance_workflow', '', true);

  INSERT INTO public.comments (ticket_id, user_id, organization_slug, content)
  VALUES (v_ticket.id, auth.uid(), v_ticket.organization_slug,
    '[Maintenance review: ' || v_decision || '] ' ||
    CASE WHEN v_decision = 'reject'
      THEN 'Previous submitted resolution: ' || left(coalesce(v_ticket.resolution_text, '—'), 1000) || '. '
      ELSE '' END ||
    CASE WHEN length(v_note) > 0 THEN v_note
      WHEN v_decision = 'approve' THEN 'Repair inspected and approved.'
      ELSE 'Correction requested.' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.review_maintenance_completion(uuid,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_maintenance_completion(uuid,text,text,timestamptz) TO authenticated;
