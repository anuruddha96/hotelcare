
-- Add image_url and is_promoted columns to minibar_items
ALTER TABLE minibar_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE minibar_items ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN DEFAULT false;

-- Create minibar-images storage bucket (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('minibar-images', 'minibar-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload minibar images
CREATE POLICY "Admins and managers can upload minibar images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'minibar-images' 
  AND (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'housekeeping_manager'::user_role]))
);

-- Allow public read access to minibar images
CREATE POLICY "Anyone can view minibar images"
ON storage.objects FOR SELECT
USING (bucket_id = 'minibar-images');

-- Allow admins to delete minibar images
CREATE POLICY "Admins can delete minibar images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'minibar-images' 
  AND (get_user_role(auth.uid()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role]))
);
