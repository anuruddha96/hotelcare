-- Fix DND photos foreign key relationship
ALTER TABLE dnd_photos 
ADD CONSTRAINT fk_dnd_photos_marked_by 
FOREIGN KEY (marked_by) REFERENCES profiles(id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_dnd_photos_room_id ON dnd_photos(room_id);
CREATE INDEX IF NOT EXISTS idx_dnd_photos_marked_by ON dnd_photos(marked_by);
CREATE INDEX IF NOT EXISTS idx_dnd_photos_assignment_date ON dnd_photos(assignment_date);