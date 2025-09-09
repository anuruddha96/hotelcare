-- Create break types configuration table for admin management
CREATE TABLE IF NOT EXISTS public.break_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  icon_name TEXT DEFAULT 'Coffee',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on break_types
ALTER TABLE public.break_types ENABLE ROW LEVEL SECURITY;

-- Create policies for break_types
CREATE POLICY "All authenticated users can view break types"
ON public.break_types
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage break types"
ON public.break_types
FOR ALL
USING (get_user_role(auth.uid()) = 'admin'::user_role)
WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

-- Insert default break types (only lunch for now as requested)
INSERT INTO public.break_types (name, display_name, duration_minutes, icon_name) VALUES
('lunch', 'Lunch Break', 30, 'Utensils')
ON CONFLICT DO NOTHING;