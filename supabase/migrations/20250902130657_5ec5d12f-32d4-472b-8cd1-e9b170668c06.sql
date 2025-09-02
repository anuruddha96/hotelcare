-- Fix 4: Secure storage policies for ticket-attachments (handle existing policies)
-- Drop existing permissive policies (check if they exist)
DO $$
BEGIN
    -- Drop policies if they exist
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated users can upload ticket attachments') THEN
        DROP POLICY "Authenticated users can upload ticket attachments" ON storage.objects;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can update/delete their own ticket attachments') THEN
        DROP POLICY "Users can update/delete their own ticket attachments" ON storage.objects;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated users can view ticket attachments') THEN
        DROP POLICY "Authenticated users can view ticket attachments" ON storage.objects;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Secure ticket attachment viewing') THEN
        DROP POLICY "Secure ticket attachment viewing" ON storage.objects;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Secure ticket attachment uploads') THEN
        DROP POLICY "Secure ticket attachment uploads" ON storage.objects;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Secure ticket attachment management') THEN
        DROP POLICY "Secure ticket attachment management" ON storage.objects;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Secure ticket attachment deletion') THEN
        DROP POLICY "Secure ticket attachment deletion" ON storage.objects;
    END IF;
END
$$;

-- Create new secure policies
-- Secure INSERT policy for ticket attachments
CREATE POLICY "Secure ticket attachment uploads"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'ticket-attachments' AND
  EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id::text = (storage.foldername(name))[1]
    AND (
      t.created_by = auth.uid() OR 
      t.assigned_to = auth.uid() OR 
      get_user_role(auth.uid()) IN ('manager', 'admin')
    )
  )
);

-- Secure SELECT policy for ticket attachments
CREATE POLICY "Secure ticket attachment viewing"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'ticket-attachments' AND
  user_can_view_ticket(((storage.foldername(name))[1])::uuid)
);

-- Secure UPDATE policy for ticket attachments
CREATE POLICY "Secure ticket attachment management"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'ticket-attachments' AND
  (
    get_user_role(auth.uid()) IN ('manager', 'admin') OR
    EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
    )
  )
);

-- Secure DELETE policy for ticket attachments
CREATE POLICY "Secure ticket attachment deletion"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'ticket-attachments' AND
  (
    get_user_role(auth.uid()) IN ('manager', 'admin') OR
    EXISTS (
      SELECT 1 FROM tickets t
      WHERE t.id::text = (storage.foldername(name))[1]
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
    )
  )
);