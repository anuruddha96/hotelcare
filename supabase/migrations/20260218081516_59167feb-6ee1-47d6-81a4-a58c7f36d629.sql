
-- Create hotel-assets storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('hotel-assets', 'hotel-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload hotel assets
CREATE POLICY "Authenticated users can upload hotel assets"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'hotel-assets'
  AND auth.role() = 'authenticated'
);

-- Allow anyone to view hotel assets (public bucket)
CREATE POLICY "Anyone can view hotel assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'hotel-assets');

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update hotel assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'hotel-assets' AND auth.role() = 'authenticated');

-- Allow authenticated users to delete hotel assets
CREATE POLICY "Authenticated users can delete hotel assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'hotel-assets' AND auth.role() = 'authenticated');
