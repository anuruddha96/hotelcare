-- Encrypt HotelCare invoice issuer credentials with a dedicated 256-bit key.
-- Key generated inside the database and stored encrypted in Supabase Vault;
-- unlike an Edge env var, it needs no manual secret copy/paste.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets
    WHERE name = 'hotelcare_invoice_issuer_credential_key'
  ) THEN
    PERFORM vault.create_secret(
      pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'),
      'hotelcare_invoice_issuer_credential_key',
      'AES-256-GCM key for HotelCare Szamlazz legal issuer credentials; never rotate without re-encrypting existing records'
    );
  END IF;
END;
$$;

-- Minimal internal RPC. The service role is the ONLY Data API role
-- allowed to retrieve the decrypted Vault key.
CREATE OR REPLACE FUNCTION public.invoice_credential_key_internal()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'hotelcare_invoice_issuer_credential_key'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.invoice_credential_key_internal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_credential_key_internal() TO service_role;
COMMENT ON FUNCTION public.invoice_credential_key_internal() IS
'Private service-role-only encryption-key retrieval for HotelCare invoice credentials. Do not expose to authenticated/anon or logs.';