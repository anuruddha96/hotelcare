DROP POLICY IF EXISTS pi_storage_insert ON storage.objects;
CREATE POLICY pi_storage_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'purchase-invoices'
  AND (storage.foldername(name))[1] = pi_user_org()
  AND pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance','back_office','reception','front_office'])
);

DROP POLICY IF EXISTS pi_storage_read ON storage.objects;
CREATE POLICY pi_storage_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'purchase-invoices'
  AND (
    pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager','control_finance'])
    OR (pi_user_role() = ANY (ARRAY['back_office','reception','front_office']) AND (storage.foldername(name))[1] = pi_user_org())
  )
);

DROP POLICY IF EXISTS pi_storage_delete ON storage.objects;
CREATE POLICY pi_storage_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'purchase-invoices'
  AND pi_user_role() = ANY (ARRAY['admin','top_management','top_management_manager'])
);