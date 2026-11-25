-- Disposable database only. Reproduce the broad legacy policies deliberately.
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated, anon, service_role;
CREATE POLICY legacy_storage ON storage.objects FOR ALL TO authenticated, anon USING(true) WITH CHECK(true);
INSERT INTO storage.buckets VALUES('other','other',false,NULL,NULL);
INSERT INTO storage.objects(bucket_id,name) VALUES('other','fixture');
CREATE TABLE public.rooms(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rooms,public.tickets TO authenticated;
CREATE POLICY legacy_rooms ON public.rooms FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY legacy_tickets ON public.tickets FOR ALL TO authenticated USING(true) WITH CHECK(true);
INSERT INTO public.rooms DEFAULT VALUES;
INSERT INTO public.tickets DEFAULT VALUES;
ALTER TABLE public.workforce_staff ADD UNIQUE(profile_id);
GRANT INSERT,UPDATE ON public.workforce_staff TO authenticated;
CREATE POLICY fixture_hr_staff_insert ON public.workforce_staff FOR INSERT TO authenticated WITH CHECK(organization_slug=public.get_user_organization_slug(auth.uid()));
CREATE POLICY fixture_hr_staff_update ON public.workforce_staff FOR UPDATE TO authenticated USING(organization_slug=public.get_user_organization_slug(auth.uid())) WITH CHECK(organization_slug=public.get_user_organization_slug(auth.uid()));
INSERT INTO public.profiles(id,full_name,role,organization_slug) VALUES
('99000000-0000-0000-0000-000000000001','New eligible employee','maintenance','rdhotels'),
('99000000-0000-0000-0000-000000000002','Other tenant employee','maintenance','slnt'),
('99000000-0000-0000-0000-000000000003','Deleted employee','housekeeping','rdhotels');
UPDATE public.profiles SET deleted_at=now() WHERE id='99000000-0000-0000-0000-000000000003';
INSERT INTO public.workforce_staff(id,organization_slug,full_name,profile_id) VALUES
('99000000-0000-0000-0000-000000000010','rdhotels','Unlinked employee',NULL),
('99000000-0000-0000-0000-000000000011','rdhotels','Privileged linked employee','10000000-0000-0000-0000-000000000011'),
('99000000-0000-0000-0000-000000000012','slnt','Other tenant employee',NULL);
