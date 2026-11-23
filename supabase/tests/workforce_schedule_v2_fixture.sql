-- Scratch-database stubs for workforce_schedule_v2_test.sql.
-- Never run this against a HotelCare database: it creates stand-ins for auth,
-- profiles and push delivery so the work-schedule migrations can be applied to
-- an empty local Postgres:
--   psql -f supabase/tests/workforce_schedule_v2_fixture.sql
--   psql -f supabase/migrations/20261112123000_workforce_schedule.sql
--   psql -f supabase/migrations/20261112140000_workforce_policy_fix.sql
--   psql -f supabase/migrations/20261117200000_access_roles_and_mira_actions.sql   (two unrelated statements fail on a scratch database)
--   psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261123120000_workforce_schedule_v2.sql
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/workforce_schedule_v2_test.sql
DO $r$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
DO $r$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
DO $r$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, organization_slug text, role text, access_role text, is_super_admin boolean DEFAULT false,
  assigned_hotel text, deleted_at timestamptz, nickname text, full_name text, app_language text, email text);
CREATE TABLE public.hotel_configurations (id uuid DEFAULT gen_random_uuid(), hotel_id text, hotel_name text, organization_id uuid);
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE);
CREATE FUNCTION public.get_user_organization_slug(_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT organization_slug FROM public.profiles WHERE id=_id $$;
CREATE TABLE public.push_log (user_ids uuid[], title text, body text, url text);
CREATE FUNCTION public.hotelcare_dispatch_push(_user_ids uuid[], _title text, _body text, _url text, _tag text, _event_type text, _data jsonb default '{}') RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO public.push_log VALUES (_user_ids,_title,_body,_url); RETURN 1; END $$;
REVOKE ALL ON FUNCTION public.hotelcare_dispatch_push(uuid[],text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;
CREATE FUNCTION public.is_super_admin(_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT COALESCE((SELECT is_super_admin FROM public.profiles WHERE id = _id), false) $$;
