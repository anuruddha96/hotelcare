-- Create sequence tracking table for usernames per organization
CREATE TABLE IF NOT EXISTS public.housekeeper_username_sequence (
  organization_slug TEXT PRIMARY KEY,
  last_sequence_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Initialize with current max (23 for rdhotels based on Nam_023)
INSERT INTO public.housekeeper_username_sequence (organization_slug, last_sequence_number)
VALUES ('rdhotels', 23)
ON CONFLICT (organization_slug) DO NOTHING;

-- Enable RLS
ALTER TABLE public.housekeeper_username_sequence ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Service role can manage sequence" ON public.housekeeper_username_sequence
  FOR ALL USING (true) WITH CHECK (true);

-- Create function to get next sequence number atomically
CREATE OR REPLACE FUNCTION public.get_next_housekeeper_sequence(p_org_slug TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  -- Insert or update and return the next sequence number
  INSERT INTO housekeeper_username_sequence (organization_slug, last_sequence_number, updated_at)
  VALUES (p_org_slug, 1, now())
  ON CONFLICT (organization_slug) 
  DO UPDATE SET 
    last_sequence_number = housekeeper_username_sequence.last_sequence_number + 1,
    updated_at = now()
  RETURNING last_sequence_number INTO next_seq;
  
  RETURN next_seq;
END;
$$;

-- Create archived housekeepers table for soft-delete with 30-day retention
CREATE TABLE IF NOT EXISTS public.archived_housekeepers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_profile_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  nickname TEXT,
  email TEXT,
  phone_number TEXT,
  organization_slug TEXT,
  assigned_hotel TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archive_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  archived_by UUID,
  performance_data JSONB,
  attendance_data JSONB,
  ratings_data JSONB,
  created_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.archived_housekeepers ENABLE ROW LEVEL SECURITY;

-- RLS policies for archived housekeepers
CREATE POLICY "Admins can view archived housekeepers" ON public.archived_housekeepers
  FOR SELECT USING (get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admins and managers can insert archived housekeepers" ON public.archived_housekeepers
  FOR INSERT WITH CHECK (
    get_user_role(auth.uid()) IN ('admin', 'manager', 'housekeeping_manager')
  );

CREATE POLICY "Admins can delete archived housekeepers" ON public.archived_housekeepers
  FOR DELETE USING (get_user_role(auth.uid()) = 'admin');