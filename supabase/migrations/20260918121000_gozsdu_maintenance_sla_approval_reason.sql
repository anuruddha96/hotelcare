-- Scope: RD Hotels / Gozsdu Court maintenance supervisor approvals only.
-- Keep the SLA requirement; do not silently waive or fabricate an operational cause.
-- Existing client approval payload does not provide sla_breach_reason. When the
-- scoped authenticated manager approves an overdue ticket, record an explicit
-- administrative explanation while preserving the unknown original delay cause.
CREATE OR REPLACE FUNCTION public.validate_ticket_closure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'completed' THEN
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    IF NEW.closed_by IS NULL THEN
      NEW.closed_by := auth.uid();
    END IF;

    IF NEW.resolution_text IS NULL OR length(trim(NEW.resolution_text)) = 0 THEN
      RAISE EXCEPTION 'Resolution text is required when closing a ticket';
    END IF;

    IF NEW.sla_due_date IS NOT NULL AND now() > NEW.sla_due_date
       AND (NEW.sla_breach_reason IS NULL OR length(trim(NEW.sla_breach_reason)) = 0) THEN
      IF OLD.hotel = 'gozsdu-court'
         AND NEW.hotel = OLD.hotel
         AND OLD.organization_slug = 'rdhotels'
         AND NEW.organization_slug = OLD.organization_slug
         AND OLD.department = 'maintenance'
         AND NEW.department = OLD.department
         AND OLD.pending_supervisor_approval IS TRUE
         AND NEW.pending_supervisor_approval IS FALSE
         AND OLD.supervisor_approved IS NOT TRUE
         AND NEW.supervisor_approved IS TRUE
         AND NEW.supervisor_approved_by = auth.uid()
         AND NEW.closed_by = auth.uid()
         AND EXISTS (
           SELECT 1 FROM public.profiles p
           WHERE p.id = auth.uid()
             AND p.organization_slug = OLD.organization_slug
             AND p.assigned_hotel = OLD.hotel
             AND p.role::text IN ('manager', 'top_management_manager')
         ) THEN
        NEW.sla_breach_reason :=
          'SLA deadline exceeded. Specific operational cause of delay was not documented; closure occurred after supervisor approval.';
      ELSE
        RAISE EXCEPTION 'SLA breach reason is required when closing tickets past their due date';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
