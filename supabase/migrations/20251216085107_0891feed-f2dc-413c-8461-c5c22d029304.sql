-- Add supervisor approval columns to tickets table for maintenance workflow
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS supervisor_approved boolean DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS supervisor_approved_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS supervisor_approved_by uuid REFERENCES profiles(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS completion_photos text[] DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pending_supervisor_approval boolean DEFAULT false;

-- Add index for efficient querying of pending approvals
CREATE INDEX IF NOT EXISTS idx_tickets_pending_supervisor_approval 
ON tickets(pending_supervisor_approval) WHERE pending_supervisor_approval = true;