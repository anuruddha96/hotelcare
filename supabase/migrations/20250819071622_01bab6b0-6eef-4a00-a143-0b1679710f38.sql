-- Fix login-related missing profiles: add trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Add fields to support closing tickets with a resolution
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS resolution_text text,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Link closed_by to profiles (do NOT reference auth.users from client-facing tables)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_closed_by_fkey'
  ) THEN
    ALTER TABLE public.tickets
    ADD CONSTRAINT tickets_closed_by_fkey
    FOREIGN KEY (closed_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;
  END IF;
END $$;

-- Set and validate completion fields with a trigger (use triggers, not CHECK constraints)
CREATE OR REPLACE FUNCTION public.set_and_validate_ticket_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_validate_ticket_completion ON public.tickets;
CREATE TRIGGER trg_set_validate_ticket_completion
BEFORE UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.set_and_validate_ticket_completion();

-- Allow maintenance and housekeeping to close tickets they created or are assigned to
DROP POLICY IF EXISTS "Maint/HK can close tickets they created or assigned" ON public.tickets;
CREATE POLICY "Maint/HK can close tickets they created or assigned"
ON public.tickets
FOR UPDATE
USING (
  get_user_role(auth.uid()) = ANY (ARRAY['maintenance'::user_role, 'housekeeping'::user_role])
  AND (assigned_to = auth.uid() OR created_by = auth.uid())
)
WITH CHECK (
  status = 'completed'
  AND resolution_text IS NOT NULL
  AND closed_by = auth.uid()
);
