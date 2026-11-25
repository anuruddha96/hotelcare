-- Phase 1: dedicated HR access, without granting broad manager powers.
CREATE OR REPLACE FUNCTION public.is_hr_manager(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = _uid AND p.id = (SELECT auth.uid()) AND p.deleted_at IS NULL
       AND (p.is_super_admin IS TRUE OR p.role::text = 'admin'
            OR public.effective_access_role(p.access_role, p.role::text) = 'hr')
  );
$$;
REVOKE ALL ON FUNCTION public.is_hr_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hr_manager(uuid) TO authenticated, service_role;

-- The restrictive scope also protects legacy HR-labelled top managers from
-- older permissive policies. Other roles retain their existing policies.
CREATE POLICY hr_break_scope ON public.break_requests AS RESTRICTIVE FOR ALL TO authenticated
USING (
  (SELECT public.current_access_role()) IS DISTINCT FROM 'hr' OR
  (organization_slug = (SELECT public.get_user_organization_slug(auth.uid()))
   AND public.get_user_organization_slug(user_id) = organization_slug)
)
WITH CHECK (
  (SELECT public.current_access_role()) IS DISTINCT FROM 'hr' OR
  (organization_slug = (SELECT public.get_user_organization_slug(auth.uid()))
   AND public.get_user_organization_slug(user_id) = organization_slug)
);
CREATE POLICY hr_break_read ON public.break_requests FOR SELECT TO authenticated
USING (
  (SELECT public.current_access_role()) = 'hr'
  AND organization_slug = (SELECT public.get_user_organization_slug(auth.uid()))
  AND public.get_user_organization_slug(user_id) = organization_slug
);
CREATE POLICY hr_break_no_direct_update ON public.break_requests AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((SELECT public.current_access_role()) IS DISTINCT FROM 'hr')
WITH CHECK ((SELECT public.current_access_role()) IS DISTINCT FROM 'hr');
CREATE POLICY hr_break_no_delete ON public.break_requests AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT public.current_access_role()) IS DISTINCT FROM 'hr');

-- Decisions only: no direct update grant, no arbitrary fields, no self-approval.
CREATE OR REPLACE FUNCTION public.hr_decide_break_request(_id uuid, _decision text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_org text;
BEGIN
  IF actor IS NULL OR NOT public.is_hr_manager(actor) OR public.current_access_role() IS DISTINCT FROM 'hr' THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.organization_slug INTO actor_org FROM public.profiles p WHERE p.id = actor AND p.deleted_at IS NULL;
  IF actor_org IS NULL THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'; END IF;
  IF _decision IS NULL OR _decision NOT IN ('approved','rejected')
     OR (_decision = 'rejected' AND NULLIF(btrim(_reason),'') IS NULL) THEN
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = '22023';
  END IF;
  UPDATE public.break_requests b SET status = _decision, approved_by = actor, approved_at = now(),
      rejection_reason = CASE WHEN _decision = 'rejected' THEN btrim(_reason) ELSE NULL END,
      updated_at = now()
    WHERE b.id = _id AND b.organization_slug = actor_org AND b.status = 'pending'
      AND b.user_id <> actor
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = b.user_id AND p.organization_slug = actor_org AND p.deleted_at IS NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'Break request not available' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.hr_decide_break_request(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_decide_break_request(uuid,text,text) TO authenticated;
