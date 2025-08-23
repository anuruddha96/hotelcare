-- Update the validation function to require SLA breach reason (with proper search_path)
CREATE OR REPLACE FUNCTION public.validate_ticket_closure()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    -- Set closed_at and closed_by if not already set
    IF NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    IF NEW.closed_by IS NULL THEN
      NEW.closed_by := auth.uid();
    END IF;
    
    -- Require resolution text
    IF NEW.resolution_text IS NULL OR length(trim(NEW.resolution_text)) = 0 THEN
      RAISE EXCEPTION 'Resolution text is required when closing a ticket';
    END IF;
    
    -- Require SLA breach reason if closing after SLA due date
    IF NEW.sla_due_date IS NOT NULL AND now() > NEW.sla_due_date THEN
      IF NEW.sla_breach_reason IS NULL OR length(trim(NEW.sla_breach_reason)) = 0 THEN
        RAISE EXCEPTION 'SLA breach reason is required when closing tickets past their due date';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Update the trigger to use the new validation function
DROP TRIGGER IF EXISTS validate_ticket_completion ON public.tickets;
CREATE TRIGGER validate_ticket_completion
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_ticket_closure();

-- Fix the search_path for the SLA function as well
CREATE OR REPLACE FUNCTION public.set_sla_due_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Set SLA due dates based on priority
  CASE NEW.priority
    WHEN 'urgent' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '4 hours';
    WHEN 'high' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '1 day';
    WHEN 'medium' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '3 days';
    WHEN 'low' THEN
      NEW.sla_due_date := NEW.created_at + INTERVAL '7 days';
  END CASE;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';