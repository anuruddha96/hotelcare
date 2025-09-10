-- Create table for DND photos
CREATE TABLE public.dnd_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL,
  assignment_id UUID NULL,
  photo_url TEXT NOT NULL,
  marked_by UUID NOT NULL,
  marked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assignment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dnd_photos ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Housekeepers can create DND photos" 
ON public.dnd_photos 
FOR INSERT 
WITH CHECK (marked_by = auth.uid() AND get_user_role(auth.uid()) = ANY(ARRAY['housekeeping'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Staff can view DND photos" 
ON public.dnd_photos 
FOR SELECT 
USING (get_user_role(auth.uid()) = ANY(ARRAY['housekeeping'::user_role, 'housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role, 'reception'::user_role]));

CREATE POLICY "Managers and admins can update DND photos" 
ON public.dnd_photos 
FOR UPDATE 
USING (get_user_role(auth.uid()) = ANY(ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role]));

-- Create trigger for updated_at
CREATE TRIGGER update_dnd_photos_updated_at
BEFORE UPDATE ON public.dnd_photos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for DND photos if it doesn't exist
INSERT INTO storage.buckets (id, name, public) VALUES ('dnd-photos', 'dnd-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for DND photos
CREATE POLICY "Authenticated users can upload DND photos" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'dnd-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view DND photos" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'dnd-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Managers can update DND photos" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'dnd-photos' AND get_user_role(auth.uid()) = ANY(ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role]));

CREATE POLICY "Managers can delete DND photos" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'dnd-photos' AND get_user_role(auth.uid()) = ANY(ARRAY['housekeeping_manager'::user_role, 'manager'::user_role, 'admin'::user_role]));