-- Allow an authenticated, property-authorized supervisor to approve submitted
-- maintenance repairs across the portfolio. Existing overdue-ticket SLA rules
-- remain enforced for every closure OTHER than a verified supervisor approval.
-- Preserve truthful audit metadata: unknown delay causes are not fabricated.

CREATE OR REPLACE FUNCTION public.can_review_maintenance_for_hotel(
  p_organization_slug text, p_hotel text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $sql$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.deleted_at IS NULL
      AND p.organization_slug = p_organization_slug
      AND p.role::text IN (
        'admin','manager','top_management','top_management_manager',
        'housekeeping_manager','maintenance_manager','reception_manager','supervisor'
      )
      AND (
        p.role::text IN ('admin','top_management')
        OR (
          p.assigned_hotel IS NOT NULL
          AND p_hotel IS NOT NULL
          AND (
            p.assigned_hotel = p_hotel
            OR public.get_hotel_name_from_id(p.assigned_hotel)
               = public.get_hotel_name_from_id(p_hotel)
            OR EXISTS (
              SELECT 1 FROM public.hotel_configurations h
              WHERE p.assigned_hotel IN (h.hotel_id,h.hotel_name)
                AND p_hotel IN (h.hotel_id,h.hotel_name)
            )
          )
        )
      )
  );
$sql$;
REVOKE ALL ON FUNCTION public.can_review_maintenance_for_hotel(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_review_maintenance_for_hotel(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_ticket_closure()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := pg_catalog.now();
    END IF;
    IF NEW.closed_by IS NULL THEN
      NEW.closed_by := auth.uid();
    END IF;
    IF NEW.resolution_text IS NULL OR pg_catalog.length(pg_catalog.btrim(NEW.resolution_text)) = 0 THEN
      RAISE EXCEPTION 'Resolution text is required when closing a ticket';
    END IF;

    IF NEW.sla_due_date IS NOT NULL AND pg_catalog.now() > NEW.sla_due_date
       AND (NEW.sla_breach_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(NEW.sla_breach_reason)) = 0) THEN
      IF OLD.department = 'maintenance'
         AND NEW.department = OLD.department
         AND NEW.organization_slug IS NOT DISTINCT FROM OLD.organization_slug
         AND NEW.hotel IS NOT DISTINCT FROM OLD.hotel
         AND OLD.status = 'in_progress'
         AND OLD.pending_supervisor_approval IS TRUE
         AND OLD.supervisor_approved IS NOT TRUE
         AND NEW.pending_supervisor_approval IS FALSE
         AND NEW.supervisor_approved IS TRUE
         AND NEW.supervisor_approved_by = auth.uid()
         AND NEW.closed_by = auth.uid()
         AND public.can_review_maintenance_for_hotel(OLD.organization_slug, OLD.hotel) THEN
        -- Administrative fact only, NOT an invented operational cause.
        NEW.sla_breach_reason :=
          'SLA deadline exceeded. The underlying operational cause of the delay was not documented; the submitted repair was closed after authorized supervisor approval.';
      ELSE
        RAISE EXCEPTION 'SLA breach reason is required when closing tickets past their due date';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_maintenance_completion(
  p_ticket_id uuid,
  p_decision text,
  p_note text,
  p_expected_updated_at timestamptz
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
      USING ERRCODE = '40001';
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
$function$;
REVOKE ALL ON FUNCTION public.review_maintenance_completion(uuid,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_maintenance_completion(uuid,text,text,timestamptz) TO authenticated;
