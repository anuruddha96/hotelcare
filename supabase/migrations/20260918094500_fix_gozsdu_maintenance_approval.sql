-- Gozsdu Court: a maintenance worker's resolved ticket can be waiting for a
-- supervisor after its SLA has elapsed. Do not require the supervisor to invent
-- an SLA-breach explanation just to approve the already-submitted resolution.
-- Continue requiring a real breach reason for ordinary overdue ticket closure,
-- and preserve a missing reason as NULL rather than fabricating one.
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
       AND (NEW.sla_breach_reason IS NULL OR length(trim(NEW.sla_breach_reason)) = 0)
       AND NOT (
         OLD.hotel = 'gozsdu-court'
         AND NEW.hotel = OLD.hotel
         AND OLD.organization_slug = 'rdhotels'
         AND NEW.organization_slug = OLD.organization_slug
         AND OLD.department = 'maintenance'
         AND NEW.department = OLD.department
         AND OLD.pending_supervisor_approval IS TRUE
         AND NEW.pending_supervisor_approval IS FALSE
         AND OLD.supervisor_approved IS NOT TRUE
         AND NEW.supervisor_approved IS TRUE
         AND NEW.status = 'completed'
         AND NEW.supervisor_approved_by = auth.uid()
         AND NEW.closed_by = auth.uid()
         AND EXISTS (
           SELECT 1 FROM public.profiles p
           WHERE p.id = auth.uid()
             AND p.organization_slug = OLD.organization_slug
             AND p.assigned_hotel = OLD.hotel
             AND p.role::text IN ('manager', 'top_management_manager')
         )
       ) THEN
      RAISE EXCEPTION 'SLA breach reason is required when closing tickets past their due date';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Only grant the additional UPDATE path to top managers of this specific
-- property/organization, and only for the pending -> approved transition.
CREATE POLICY "Gozsdu top managers approve maintenance"
ON public.tickets FOR UPDATE TO authenticated
USING (
  hotel = 'gozsdu-court'
  AND organization_slug = 'rdhotels'
  AND department = 'maintenance'
  AND pending_supervisor_approval IS TRUE
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role::text = 'top_management_manager'
      AND p.organization_slug = 'rdhotels'
      AND p.assigned_hotel = 'gozsdu-court'
  )
)
WITH CHECK (
  hotel = 'gozsdu-court'
  AND organization_slug = 'rdhotels'
  AND department = 'maintenance'
  AND status = 'completed'
  AND pending_supervisor_approval IS FALSE
  AND supervisor_approved IS TRUE
  AND supervisor_approved_by = auth.uid()
  AND closed_by = auth.uid()
);

-- RLS cannot compare OLD and NEW columns. Prevent the additional policy above
-- from being used by top managers to modify unrelated ticket fields.
CREATE OR REPLACE FUNCTION public.guard_gozsdu_top_manager_ticket_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.hotel = 'gozsdu-court'
     AND OLD.organization_slug = 'rdhotels'
     AND OLD.department = 'maintenance'
     AND public.get_user_role(auth.uid())::text = 'top_management_manager'
     AND (
       OLD.pending_supervisor_approval IS NOT TRUE
       OR NEW.pending_supervisor_approval IS NOT FALSE
       OR NEW.supervisor_approved IS NOT TRUE
       OR NEW.supervisor_approved_by IS DISTINCT FROM auth.uid()
       OR NEW.closed_by IS DISTINCT FROM auth.uid()
       OR NEW.status::text <> 'completed'
       OR (to_jsonb(NEW) - ARRAY['status','pending_supervisor_approval','supervisor_approved','supervisor_approved_at','supervisor_approved_by','closed_at','closed_by','updated_at'])
          IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['status','pending_supervisor_approval','supervisor_approved','supervisor_approved_at','supervisor_approved_by','closed_at','closed_by','updated_at'])
     ) THEN
    RAISE EXCEPTION 'Only maintenance approval is permitted for this Gozsdu manager role';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_guard_gozsdu_top_manager_ticket_approval
BEFORE UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.guard_gozsdu_top_manager_ticket_approval();