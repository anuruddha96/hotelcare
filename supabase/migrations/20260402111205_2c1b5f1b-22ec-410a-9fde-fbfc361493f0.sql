-- Enable RLS if not already enabled
ALTER TABLE public.housekeeper_username_sequence ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read sequence numbers
CREATE POLICY "Authenticated users can read sequence numbers"
ON public.housekeeper_username_sequence
FOR SELECT
TO authenticated
USING (true);