-- Add hold status tracking to tickets table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS on_hold boolean DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS hold_reason text;