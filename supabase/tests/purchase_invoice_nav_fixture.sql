-- Disposable PostgreSQL prerequisites for the purchase-invoice NAV migration CI.
-- Run order (see .github/workflows/purchase-invoice-nav-ci.yml):
--   this fixture → existing purchase-invoice migrations (verbatim) →
--   purchase_invoice_nav_fixture_post.sql → the NAV migration → the test.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth, extensions TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

-- Supabase Vault stand-in (encryption is not under test here).
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, secret AS decrypted_secret, description FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text, new_description text DEFAULT '')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO vault.secrets (name, secret, description) VALUES (new_name, new_secret, new_description) RETURNING id
$$;

-- Supabase Storage stand-in.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
GRANT USAGE ON SCHEMA storage TO authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;

-- Core HotelCare objects the purchase-invoice migrations depend on.
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('admin','top_management','top_management_manager','manager','control_finance',
    'reception','front_office','housekeeping','hr');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, name text
);
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  role public.user_role NOT NULL,
  organization_slug text,
  assigned_hotel text,
  nickname text,
  full_name text,
  is_super_admin boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.profiles, public.organizations TO authenticated;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

INSERT INTO public.organizations (slug, name) VALUES ('rdhotels', 'RD Hotels'), ('otherorg', 'Other Org')
ON CONFLICT DO NOTHING;
