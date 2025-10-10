-- Create housekeeper ratings table
CREATE TABLE public.housekeeper_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  housekeeper_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating NUMERIC(2,1) NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
  assignment_id UUID REFERENCES public.room_assignments(id) ON DELETE SET NULL,
  rating_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  organization_slug TEXT DEFAULT 'rdhotels',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.housekeeper_ratings ENABLE ROW LEVEL SECURITY;

-- Managers and admins can create ratings
CREATE POLICY "Managers can create ratings"
ON public.housekeeper_ratings
FOR INSERT
WITH CHECK (
  rated_by = auth.uid() AND
  get_user_role(auth.uid()) = ANY(ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
);

-- Managers and admins can update their own ratings
CREATE POLICY "Managers can update their own ratings"
ON public.housekeeper_ratings
FOR UPDATE
USING (
  rated_by = auth.uid() AND
  get_user_role(auth.uid()) = ANY(ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
);

-- Housekeepers can view their own ratings, managers can view all
CREATE POLICY "Housekeepers view own ratings, managers view all"
ON public.housekeeper_ratings
FOR SELECT
USING (
  housekeeper_id = auth.uid() OR
  get_user_role(auth.uid()) = ANY(ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
);

-- Managers and admins can delete ratings
CREATE POLICY "Managers can delete ratings"
ON public.housekeeper_ratings
FOR DELETE
USING (
  get_user_role(auth.uid()) = ANY(ARRAY['manager'::user_role, 'housekeeping_manager'::user_role, 'admin'::user_role])
);

-- Create trigger for updated_at
CREATE TRIGGER update_housekeeper_ratings_updated_at
BEFORE UPDATE ON public.housekeeper_ratings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to get housekeeper average rating
CREATE OR REPLACE FUNCTION public.get_housekeeper_avg_rating(p_housekeeper_id UUID, days_back INTEGER DEFAULT 30)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(ROUND(AVG(rating), 1), 0.0)
  FROM public.housekeeper_ratings
  WHERE housekeeper_id = p_housekeeper_id
  AND rating_date >= CURRENT_DATE - INTERVAL '1 day' * days_back;
$$;