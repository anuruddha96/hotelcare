-- Add ready_to_clean field to room_assignments for checkout room workflow
ALTER TABLE public.room_assignments 
ADD COLUMN ready_to_clean boolean NOT NULL DEFAULT false;

-- Add comment to explain the new field
COMMENT ON COLUMN public.room_assignments.ready_to_clean IS 'Indicates if a checkout room is ready to be cleaned (guest has actually checked out)';

-- Create index for better performance when filtering by ready_to_clean status
CREATE INDEX idx_room_assignments_ready_to_clean ON public.room_assignments(ready_to_clean, assignment_date, assignment_type);