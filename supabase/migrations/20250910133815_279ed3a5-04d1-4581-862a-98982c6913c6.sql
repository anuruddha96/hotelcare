-- Add DND (Do Not Disturb) functionality to room assignments
ALTER TABLE public.room_assignments 
ADD COLUMN is_dnd boolean DEFAULT false,
ADD COLUMN dnd_marked_at timestamp with time zone,
ADD COLUMN dnd_marked_by uuid;

-- Add comment for clarity
COMMENT ON COLUMN public.room_assignments.is_dnd IS 'Indicates if room is marked as Do Not Disturb by housekeeper';
COMMENT ON COLUMN public.room_assignments.dnd_marked_at IS 'Timestamp when DND was marked';
COMMENT ON COLUMN public.room_assignments.dnd_marked_by IS 'User who marked DND';

-- Also add DND status to rooms table for display purposes
ALTER TABLE public.rooms 
ADD COLUMN is_dnd boolean DEFAULT false,
ADD COLUMN dnd_marked_at timestamp with time zone,
ADD COLUMN dnd_marked_by uuid;

COMMENT ON COLUMN public.rooms.is_dnd IS 'Current DND status of room';
COMMENT ON COLUMN public.rooms.dnd_marked_at IS 'When DND was last marked';
COMMENT ON COLUMN public.rooms.dnd_marked_by IS 'Who marked DND';