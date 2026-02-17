
-- Create assignment_patterns table for learning from manager assignment decisions
CREATE TABLE public.assignment_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel text NOT NULL,
  room_number_a text NOT NULL,
  room_number_b text NOT NULL,
  pair_count integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  organization_slug text DEFAULT 'rdhotels',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hotel, room_number_a, room_number_b, organization_slug)
);

-- Enable RLS
ALTER TABLE public.assignment_patterns ENABLE ROW LEVEL SECURITY;

-- Managers and admins can read patterns
CREATE POLICY "Managers and admins can view assignment patterns"
ON public.assignment_patterns
FOR SELECT
USING (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

-- Managers and admins can insert patterns
CREATE POLICY "Managers and admins can insert assignment patterns"
ON public.assignment_patterns
FOR INSERT
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

-- Managers and admins can update patterns (for upsert/increment)
CREATE POLICY "Managers and admins can update assignment patterns"
ON public.assignment_patterns
FOR UPDATE
USING (get_user_role(auth.uid()) = ANY (ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role]));

-- Index for fast lookups by hotel
CREATE INDEX idx_assignment_patterns_hotel ON public.assignment_patterns(hotel, organization_slug);
