-- Replace a retryable serialization SQLSTATE used for an ordinary optimistic conflict.
-- SQLSTATE 40001 on PostgREST 14 can cause uncontrolled retries; PT409 maps to HTTP 409.
-- This migration intentionally keeps all other validation, authorization and writes unchanged.
CREATE OR REPLACE FUNCTION public.review_maintenance_completion(p_ticket_id uuid, p_decision text, p_note text, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_decision text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_decision,'')));
  v_note text := pg_catalog.btrim(coalesce(p_note,''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to review maintenance' USING ERRCODE = '28000';
  END IF;
  IF v_decision NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'Invalid review decision' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_note) > 2000 OR
     (v_decision='reject' AND pg_catalog.length(v_note) < 3) THEN
    RAISE EXCEPTION 'A rejection reason of 3 to 2000 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ticket FROM public.tickets WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.department IS DISTINCT FROM 'maintenance' THEN
    RAISE EXCEPTION 'Maintenance ticket not found' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_review_maintenance_for_hotel(v_ticket.organization_slug,v_ticket.hotel) THEN
    RAISE EXCEPTION 'Ticket does not belong to your selected hotel or you cannot review maintenance work'
      USING ERRCODE = '42501';
  END IF;
  IF p_expected_updated_at IS NULL
     OR v_ticket.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'This ticket was updated by another user. Refresh and try again.'
      USING ERRCODE = 'PT409';
  END IF;
  IF v_ticket.status IS DISTINCT FROM 'in_progress'
     OR v_ticket.pending_supervisor_approval IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Ticket is not awaiting maintenance approval' USING ERRCODE = '22023';
  END IF;
  IF v_ticket.assigned_to IS NOT NULL AND v_ticket.assigned_to = auth.uid() THEN
    RAISE EXCEPTION 'A worker cannot approve their own repair' USING ERRCODE = '42501';
  END IF;
  IF v_decision='approve'
     AND pg_catalog.length(pg_catalog.btrim(coalesce(v_ticket.resolution_text,''))) < 3 THEN
    RAISE EXCEPTION 'Cannot approve a ticket without a repair description' USING ERRCODE = '22023';
  END IF;

  -- Needed by the existing Gozsdu top-manager field-change guard; this is
  -- set only after authorization, ticket state and concurrency validation.
  PERFORM pg_catalog.set_config('hotelcare.manual_maintenance_workflow','validated',true);
  IF v_decision='approve' THEN
    UPDATE public.tickets SET
      status='completed', pending_supervisor_approval=FALSE,
      supervisor_approved=TRUE, supervisor_approved_at=pg_catalog.now(),
      supervisor_approved_by=auth.uid(), closed_by=auth.uid(),
      closed_at=pg_catalog.now(), on_hold=FALSE, hold_reason=NULL
    WHERE id=v_ticket.id;
  ELSE
    UPDATE public.tickets SET
      status='in_progress', pending_supervisor_approval=FALSE,
      supervisor_approved=FALSE, supervisor_approved_at=NULL,
      supervisor_approved_by=NULL, closed_by=NULL, closed_at=NULL,
      resolution_text=NULL, on_hold=FALSE, hold_reason=NULL
    WHERE id=v_ticket.id;
  END IF;
  PERFORM pg_catalog.set_config('hotelcare.manual_maintenance_workflow','',true);

  INSERT INTO public.comments(ticket_id,user_id,organization_slug,content)
  VALUES (
    v_ticket.id,auth.uid(),v_ticket.organization_slug,
    '[Maintenance review: '||v_decision||'] '||
    CASE WHEN v_decision='reject' THEN
      'Previous submitted resolution: '||
      pg_catalog.left(coalesce(v_ticket.resolution_text,'—'),1000)||'. '
    ELSE '' END ||
    CASE WHEN pg_catalog.length(v_note)>0 THEN v_note
      WHEN v_decision='approve' THEN 'Repair inspected and approved.'
      ELSE 'Correction requested.' END
  );
END;
$function$
;
