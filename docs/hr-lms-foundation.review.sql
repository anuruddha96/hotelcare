-- REVIEW SQL ONLY. Generate a versioned migration with Supabase CLI after CI and production preflight.
-- New LMS evidence is distinct from mutable legacy tour progress.
CREATE SCHEMA IF NOT EXISTS lms_internal;
REVOKE ALL ON SCHEMA lms_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA lms_internal TO authenticated;
CREATE FUNCTION lms_internal.active_tenant(_org text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN public.organizations o ON o.slug=p.organization_slug
 WHERE p.id=(SELECT auth.uid()) AND p.deleted_at IS NULL AND o.is_active IS TRUE AND p.organization_slug=_org);
$$;
CREATE FUNCTION lms_internal.can_manage(_org text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT lms_internal.active_tenant(_org) AND EXISTS(SELECT 1 FROM public.profiles p
 WHERE p.id=(SELECT auth.uid()) AND p.deleted_at IS NULL AND p.organization_slug=_org
 AND public.effective_access_role(p.access_role,p.role::text)='hr');
$$;
CREATE FUNCTION lms_internal.can_read_employee(_org text,_employee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT lms_internal.active_tenant(_org) AND (
  _employee=(SELECT auth.uid()) OR
  (lms_internal.can_manage(_org) AND EXISTS(SELECT 1 FROM public.profiles p
   WHERE p.id=_employee AND p.organization_slug=_org AND p.deleted_at IS NULL
   AND p.is_super_admin IS NOT TRUE
   AND p.role::text NOT IN ('admin','top_management','top_management_manager','hr','control_finance')
   AND public.effective_access_role(p.access_role,p.role::text) NOT IN ('admin','top_management','controlling','hr'))));
$$;
REVOKE ALL ON FUNCTION lms_internal.active_tenant(text),lms_internal.can_manage(text),lms_internal.can_read_employee(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION lms_internal.active_tenant(text),lms_internal.can_manage(text),lms_internal.can_read_employee(text,uuid) TO authenticated;

CREATE TABLE public.lms_courses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL REFERENCES public.organizations(slug),
 slug text NOT NULL CHECK(length(btrim(slug)) BETWEEN 1 AND 160), title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 300),
 source_guide_key text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz, UNIQUE(organization_slug,id), UNIQUE(organization_slug,slug)
);
CREATE TABLE public.lms_course_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL, course_id uuid NOT NULL,
 version_no integer NOT NULL CHECK(version_no>0), title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 300),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 required_pass_percent integer NOT NULL DEFAULT 80 CHECK(required_pass_percent BETWEEN 1 AND 100),
 FOREIGN KEY(organization_slug,course_id) REFERENCES public.lms_courses(organization_slug,id),
 UNIQUE(organization_slug,id), UNIQUE(organization_slug,course_id,version_no),
 CHECK(status<>'published' OR published_at IS NOT NULL)
);
CREATE TABLE public.lms_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL, version_id uuid NOT NULL,
 employee_id uuid NOT NULL, assigned_by uuid NOT NULL, assigned_at timestamptz NOT NULL DEFAULT now(),
 starts_on date NOT NULL, due_on date, mandatory boolean NOT NULL DEFAULT true, cancelled_at timestamptz,
 request_key uuid NOT NULL, FOREIGN KEY(organization_slug,version_id) REFERENCES public.lms_course_versions(organization_slug,id),
 UNIQUE(organization_slug,id), UNIQUE(organization_slug,id,employee_id), UNIQUE(organization_slug,request_key,employee_id),
 CHECK(due_on IS NULL OR due_on>=starts_on)
);
CREATE TABLE public.lms_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL, assignment_id uuid NOT NULL,
 employee_id uuid NOT NULL, attempt_no integer NOT NULL CHECK(attempt_no>0),
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 status text NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','abandoned')),
 FOREIGN KEY(organization_slug,assignment_id,employee_id) REFERENCES public.lms_assignments(organization_slug,id,employee_id),
 UNIQUE(organization_slug,id), UNIQUE(organization_slug,assignment_id,attempt_no),
 CHECK(completed_at IS NULL OR completed_at>=started_at),
 CHECK((status='completed')=(completed_at IS NOT NULL))
);
CREATE TABLE public.lms_audit_log(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_slug text NOT NULL REFERENCES public.organizations(slug),
 actor_id uuid NOT NULL, employee_id uuid, action text NOT NULL CHECK(length(btrim(action))>0),
 entity_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lms_assignment_employee_idx ON public.lms_assignments(organization_slug,employee_id,starts_on);
CREATE INDEX lms_assignment_version_idx ON public.lms_assignments(organization_slug,version_id);
CREATE INDEX lms_attempt_employee_idx ON public.lms_attempts(organization_slug,employee_id);
CREATE INDEX lms_audit_org_idx ON public.lms_audit_log(organization_slug,occurred_at);
ALTER TABLE public.lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_course_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lms_courses,public.lms_course_versions,public.lms_assignments,public.lms_attempts,public.lms_audit_log FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lms_courses,public.lms_course_versions,public.lms_assignments,public.lms_attempts,public.lms_audit_log TO authenticated;
-- No authenticated writes in this phase; assignment RPC and publishing API come later.
CREATE POLICY lms_assignments_read ON public.lms_assignments FOR SELECT TO authenticated
 USING(lms_internal.can_read_employee(organization_slug,employee_id));
CREATE POLICY lms_attempts_read ON public.lms_attempts FOR SELECT TO authenticated
 USING(lms_internal.can_read_employee(organization_slug,employee_id));
CREATE POLICY lms_versions_read ON public.lms_course_versions FOR SELECT TO authenticated USING(
 lms_internal.can_manage(organization_slug) OR
 (lms_internal.active_tenant(organization_slug) AND status IN ('published','archived') AND EXISTS(
 SELECT 1 FROM public.lms_assignments a WHERE a.organization_slug=lms_course_versions.organization_slug
 AND a.version_id=lms_course_versions.id AND a.employee_id=(SELECT auth.uid()))));
CREATE POLICY lms_courses_read ON public.lms_courses FOR SELECT TO authenticated USING(
 lms_internal.can_manage(organization_slug) OR
 (lms_internal.active_tenant(organization_slug) AND EXISTS(
 SELECT 1 FROM public.lms_course_versions v WHERE v.organization_slug=lms_courses.organization_slug AND v.course_id=lms_courses.id
 AND v.status IN ('published','archived'))));
CREATE POLICY lms_audit_read ON public.lms_audit_log FOR SELECT TO authenticated USING(
 lms_internal.can_manage(organization_slug) AND (employee_id IS NULL OR lms_internal.can_read_employee(organization_slug,employee_id)));
-- Published content cannot silently change underneath assignments. Archive is explicit.
CREATE FUNCTION lms_internal.protect_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.status IN ('published','archived') AND (
 TG_OP='DELETE' OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug OR NEW.course_id IS DISTINCT FROM OLD.course_id
 OR NEW.id IS DISTINCT FROM OLD.id OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.title IS DISTINCT FROM OLD.title
 OR NEW.required_pass_percent IS DISTINCT FROM OLD.required_pass_percent OR NEW.published_at IS DISTINCT FROM OLD.published_at
 OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 OR (OLD.status='archived' AND NEW.status<>'archived') OR NEW.status='draft') THEN
 RAISE EXCEPTION 'Published version is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER lms_protect_version BEFORE UPDATE OR DELETE ON public.lms_course_versions FOR EACH ROW EXECUTE FUNCTION lms_internal.protect_version();
CREATE FUNCTION lms_internal.prevent_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Learning history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER lms_audit_immutable BEFORE UPDATE OR DELETE ON public.lms_audit_log FOR EACH ROW EXECUTE FUNCTION lms_internal.prevent_history_change();
CREATE TRIGGER lms_completed_attempt_immutable BEFORE UPDATE OR DELETE ON public.lms_attempts FOR EACH ROW WHEN(OLD.status='completed') EXECUTE FUNCTION lms_internal.prevent_history_change();
