-- Allow room_id to be NULL in lost_and_found table for general items
ALTER TABLE lost_and_found ALTER COLUMN room_id DROP NOT NULL;