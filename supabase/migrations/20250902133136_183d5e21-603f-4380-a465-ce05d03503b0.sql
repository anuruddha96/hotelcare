-- Add bed_type column to rooms table
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS bed_type text;

-- Update room_type options and add bed_type options
UPDATE public.rooms SET bed_type = 'double' WHERE bed_type IS NULL;

-- Add comments for clarity
COMMENT ON COLUMN public.rooms.room_type IS 'Room category: standard, deluxe, comfort, economy, suite, presidential';
COMMENT ON COLUMN public.rooms.bed_type IS 'Bed configuration: single, double, queen, triple, quadruple';