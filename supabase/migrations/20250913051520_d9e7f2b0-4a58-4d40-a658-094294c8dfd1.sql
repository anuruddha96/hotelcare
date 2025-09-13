-- Add completion_photos column to room_assignments if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'room_assignments' 
        AND column_name = 'completion_photos'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE public.room_assignments 
        ADD COLUMN completion_photos text[] DEFAULT '{}';
    END IF;
END $$;