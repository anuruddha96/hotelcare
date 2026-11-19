-- Minimal Supabase stand-ins for the website sales chat migration: API roles with
-- Supabase's default grants, pg_cron and Vault.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase grants everything in public to the API roles by default; RLS and
-- explicit REVOKEs are what actually protect objects.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE OR REPLACE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE OR REPLACE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean
LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), secret text NOT NULL, name text UNIQUE, description text);
CREATE OR REPLACE FUNCTION vault.create_secret(p_secret text, p_name text, p_description text) RETURNS uuid
LANGUAGE sql AS $$ INSERT INTO vault.secrets (secret, name, description) VALUES (p_secret, p_name, p_description) RETURNING id $$;
CREATE OR REPLACE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret AS decrypted_secret FROM vault.secrets;
