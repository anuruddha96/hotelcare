-- Add hotel assignment to profiles table
ALTER TABLE public.profiles ADD COLUMN assigned_hotel text;

-- Create hotels table
CREATE TABLE public.hotels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on hotels table
ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to view hotels
CREATE POLICY "All authenticated users can view hotels" 
ON public.hotels 
FOR SELECT 
USING (true);

-- Only admins can manage hotels
CREATE POLICY "Admins can manage hotels" 
ON public.hotels 
FOR ALL 
USING (get_user_role(auth.uid()) = 'admin'::user_role)
WITH CHECK (get_user_role(auth.uid()) = 'admin'::user_role);

-- Add trigger for updating updated_at on hotels
CREATE TRIGGER update_hotels_updated_at
BEFORE UPDATE ON public.hotels
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default hotels
INSERT INTO public.hotels (name) VALUES 
  ('Hotel Memories Budapest'),
  ('Hotel Mika Downtown'),
  ('Hotel Ottofiori'),
  ('Gozsdu Court Budapest');

-- Add room_name column to rooms table for manual naming like PMS systems
ALTER TABLE public.rooms ADD COLUMN room_name text;

-- Update existing rooms to have room_name based on room_number if not set
UPDATE public.rooms SET room_name = room_number WHERE room_name IS NULL;