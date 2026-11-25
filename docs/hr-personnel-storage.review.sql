-- REVIEW DRAFT ONLY. Do not run against production.
-- Generate a versioned migration with the Supabase CLI after staging review.
BEGIN;
-- Restrict legacy executive HR access without changing other roles.
CREATE POLICY hr_no_room_operations ON public.rooms AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.current_access_role()) IS DISTINCT FROM 'hr')
WITH CHECK ((SELECT public.current_access_role()) IS DISTINCT FROM 'hr');
CREATE POLICY hr_no_ticket_operations ON public.tickets AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.current_access_role()) IS DISTINCT FROM 'hr')
WITH CHECK ((SELECT public.current_access_role()) IS DISTINCT FROM 'hr');

-- Do not allow HR to attach or detach privileged identities by manipulating
-- workforce_staff directly. Existing links may remain unchanged.
CREATE FUNCTION public.hr_guard_workforce_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE candidate uuid;
BEGIN
  IF (SELECT public.current_access_role()) IS DISTINCT FROM 'hr' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.profile_id IS NOT DISTINCT FROM OLD.profile_id THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.profile_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id=OLD.profile_id AND
        (p.id=auth.uid() OR p.is_super_admin IS TRUE OR p.role::text IN ('admin','top_management','top_management_manager','hr','control_finance')
          OR public.effective_access_role(p.access_role,p.role::text) IN ('admin','top_management','hr','controlling'))
    ) THEN RAISE EXCEPTION 'Privileged account requires administrator review' USING ERRCODE='42501'; END IF;
  END IF;
  candidate := NEW.profile_id;
  IF candidate IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id=candidate AND p.id<>auth.uid()
      AND p.organization_slug=NEW.organization_slug AND p.deleted_at IS NULL
      AND p.is_super_admin IS NOT TRUE
      AND p.role::text NOT IN ('admin','top_management','top_management_manager','hr','control_finance')
      AND public.effective_access_role(p.access_role,p.role::text) NOT IN ('admin','top_management','hr','controlling')
  ) THEN RAISE EXCEPTION 'Account is not eligible' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hr_guard_workforce_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER hr_guard_workforce_link BEFORE INSERT OR UPDATE OF profile_id ON public.workforce_staff
FOR EACH ROW EXECUTE FUNCTION public.hr_guard_workforce_link();

-- Confidential HR metadata deliberately separate from the workforce directory.
CREATE TABLE public.hr_personnel_documents (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES public.workforce_staff(id) ON DELETE RESTRICT,
  organization_slug text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  category text NOT NULL CHECK (category IN ('contract','permit','certificate','payroll','policy','other')),
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 180),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  object_path text NOT NULL UNIQUE,
  issued_on date,
  expires_on date,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_by uuid,
  archived_at timestamptz,
  CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE INDEX hr_personnel_documents_staff_idx ON public.hr_personnel_documents(organization_slug,staff_id,created_at DESC);
ALTER TABLE public.hr_personnel_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_personnel_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.hr_personnel_documents TO service_role;
CREATE TABLE public.hr_personnel_document_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  staff_id uuid NOT NULL,
  document_id uuid,
  actor_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN ('list','upload','download_link_issued','archive')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hr_personnel_document_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hr_personnel_document_audit FROM PUBLIC, anon, authenticated;
GRANT INSERT,SELECT ON public.hr_personnel_document_audit TO service_role;
CREATE FUNCTION public.hr_personnel_document_audit_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.hr_personnel_document_audit(organization_slug,staff_id,document_id,actor_id,event)
    VALUES(NEW.organization_slug,NEW.staff_id,NEW.id,NEW.created_by,'upload');
  ELSIF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    INSERT INTO public.hr_personnel_document_audit(organization_slug,staff_id,document_id,actor_id,event)
    VALUES(NEW.organization_slug,NEW.staff_id,NEW.id,NEW.archived_by,'archive');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.hr_personnel_document_audit_write() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER hr_personnel_document_audit_write AFTER INSERT OR UPDATE ON public.hr_personnel_documents
FOR EACH ROW EXECUTE FUNCTION public.hr_personnel_document_audit_write();
-- Storage objects may only be accessed through the verified server endpoint.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('hr-personnel-documents','hr-personnel-documents',false,10485760,ARRAY['application/pdf','image/jpeg','image/png']);
CREATE POLICY hr_personnel_bucket_no_direct_access ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated, anon
USING (bucket_id <> 'hr-personnel-documents') WITH CHECK (bucket_id <> 'hr-personnel-documents');
COMMIT;
