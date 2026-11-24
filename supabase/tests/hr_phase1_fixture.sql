-- Run after access_roles_fixture.sql and access_roles migration.
CREATE TABLE public.break_requests (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id),
  requested_by uuid NOT NULL REFERENCES public.profiles(id), organization_slug text,
  status text NOT NULL DEFAULT 'pending', reason text NOT NULL DEFAULT 'fixture',
  approved_by uuid, approved_at timestamptz, rejection_reason text, updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.break_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.break_requests TO authenticated;
-- Representative production legacy permissive policies, including top management.
CREATE POLICY "Users can view own break requests" ON public.break_requests FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR requested_by = auth.uid() OR public.get_user_role(auth.uid()) IN ('manager','housekeeping_manager','admin')
);
CREATE POLICY "Managers can update break requests" ON public.break_requests FOR UPDATE TO authenticated USING (
  public.get_user_role(auth.uid()) IN ('manager','housekeeping_manager','admin')
);
CREATE POLICY tm_hk_select_break_requests ON public.break_requests FOR SELECT TO authenticated USING (
  public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid()))
);
CREATE POLICY tm_hk_update_break_requests ON public.break_requests FOR UPDATE TO authenticated USING (
  public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid()))
);
CREATE POLICY tm_hk_delete_break_requests ON public.break_requests FOR DELETE TO authenticated USING (
  public.is_top_management(auth.uid()) AND (organization_slug IS NULL OR organization_slug = public.get_user_organization_slug(auth.uid()))
);
INSERT INTO public.profiles (id,full_name,nickname,role,organization_slug,access_role) VALUES
 ('90000000-0000-0000-0000-000000000001','Fixture HR','fixture_hr','hr','rdhotels',NULL),
 ('90000000-0000-0000-0000-000000000002','Fixture other HR','fixture_hr_other','hr','slnt',NULL),
 ('90000000-0000-0000-0000-000000000003','Fixture labelled HR','fixture_hr_label','top_management_manager','rdhotels','hr');
INSERT INTO public.break_requests (id,user_id,requested_by,organization_slug) VALUES
 ('91000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000009','rdhotels'),
 ('91000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000012','slnt'),
 ('91000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','rdhotels'),
 ('91000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000009','rdhotels'),
 ('91000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000012','rdhotels');
