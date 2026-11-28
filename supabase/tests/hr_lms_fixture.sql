-- Disposable fixture, not a production schema clone.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TABLE public.organizations(slug text PRIMARY KEY,is_active boolean NOT NULL);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_slug text,role text,access_role text,is_super_admin boolean,deleted_at timestamptz);
CREATE FUNCTION public.effective_access_role(a text,r text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT coalesce(a,r)$$;
INSERT INTO public.organizations VALUES('rdhotels',true),('slnt',true),('inactive',false);
INSERT INTO public.profiles VALUES
 ('10000000-0000-0000-0000-000000000001','rdhotels','hr',NULL,false,NULL),
 ('10000000-0000-0000-0000-000000000002','rdhotels','housekeeping',NULL,false,NULL),
 ('10000000-0000-0000-0000-000000000003','rdhotels','manager',NULL,false,NULL),
 ('10000000-0000-0000-0000-000000000004','slnt','hr',NULL,false,NULL),
 ('10000000-0000-0000-0000-000000000005','slnt','housekeeping',NULL,false,NULL),
 ('10000000-0000-0000-0000-000000000006','rdhotels','admin',NULL,true,NULL),
 ('10000000-0000-0000-0000-000000000007','rdhotels','hr',NULL,false,now()),
 ('10000000-0000-0000-0000-000000000008','inactive','hr',NULL,false,NULL);
