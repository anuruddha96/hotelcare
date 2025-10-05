-- Create room-photos storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('room-photos', 'room-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for room-photos bucket
CREATE POLICY "Anyone can view room photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'room-photos');

CREATE POLICY "Authenticated users can upload room photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'room-photos' AND
  auth.role() = 'authenticated'
);

CREATE POLICY "Users can update their own room photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'room-photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own room photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'room-photos' AND
  auth.uid()::text = (storage.foldername(name))[1]
);