-- Create storage bucket for ticket attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-attachments', 
  'ticket-attachments', 
  false,
  10485760,  -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
);

-- Create RLS policies for ticket attachments
CREATE POLICY "Users can view ticket attachments they have access to" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'ticket-attachments' 
  AND EXISTS (
    SELECT 1 FROM public.tickets t 
    WHERE t.id::text = (storage.foldername(name))[1]
    -- User can see the ticket, so they can see its attachments
  )
);

CREATE POLICY "Authenticated users can upload ticket attachments" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'ticket-attachments' 
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Users can update their own ticket attachments" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'ticket-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own ticket attachments" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'ticket-attachments' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);