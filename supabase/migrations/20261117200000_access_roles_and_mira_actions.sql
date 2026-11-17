-- Access roles, staff-schedule go-live switch and persistent Mira approvals.
--
-- 1. profiles.access_role: the role a person really has (Top management,
--    Controlling, HR, Manager, Housekeeping manager, Housekeeping supervisor,
--    Reception, Housekeeper, Maintenance, Breakfast). It decides landing page,
--    Mira, work-schedule scope and review replies in the app.
--    profiles.role stays the database permission level that 600+ RLS
--    policies and the Edge Functions already understand, so nothing that works
--    today changes. An access role is only accepted when it fits the
--    permission level (a receptionist on the `manager` level may be labelled
--    Reception; a housekeeper can never be labelled Top management).
-- 2. Housekeeping managers and supervisors see and plan the work schedule of
--    their own hotel only (the hotel of their work-schedule record), even when
--    they switch hotels for the day.
-- 3. Housekeepers and maintenance staff do not see their schedule until an
--    HR / top-management user puts it live (workforce_settings).
-- 4. assistant_action_requests: a plan Mira prepared (rate plan, schedule
--    plan), the exact decision on it (who, when, which items, the consent
--    sentence) and the result. Written only by Edge Functions; the decision
--    can never be edited afterwards.

-- ---------------------------------------------------------------------------
-- 1. Access roles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS access_role text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_access_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_access_role_check CHECK (
  access_role IS NULL OR access_role IN (
    'admin', 'top_management', 'controlling', 'hr', 'manager', 'housekeeping_manager',
    'housekeeping_supervisor', 'reception', 'housekeeping', 'maintenance', 'breakfast', 'other'
  )
);

COMMENT ON COLUMN public.profiles.access_role IS
  'Role in the app (landing page, Mira, schedule scope, review replies). NULL = derived from profiles.role. Must fit profiles.role (access_role_allows_permission).';

-- Role used when no access role is set: what the permission level means today.
CREATE OR REPLACE FUNCTION public.access_role_from_permission(_role text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _role = 'admin' THEN 'admin'
    WHEN _role IN ('top_management', 'top_management_manager') THEN 'top_management'
    WHEN _role IN ('control_finance', 'control_manager', 'finance_manager') THEN 'controlling'
    WHEN _role = 'hr' THEN 'hr'
    WHEN _role = 'manager' THEN 'manager'
    WHEN _role = 'housekeeping_manager' THEN 'housekeeping_manager'
    WHEN _role = 'supervisor' THEN 'housekeeping_supervisor'
    WHEN _role IN ('reception', 'front_office', 'reception_manager') THEN 'reception'
    WHEN _role = 'housekeeping' THEN 'housekeeping'
    WHEN _role IN ('maintenance', 'maintenance_manager') THEN 'maintenance'
    WHEN _role = 'breakfast_staff' THEN 'breakfast'
    ELSE 'other'
  END
$$;

-- Which permission levels an access role may sit on. Mirrors
-- supabase/functions/_shared/accessPolicy.ts (ACCESS_ROLE_PERMISSIONS).
CREATE OR REPLACE FUNCTION public.access_role_allows_permission(_access_role text, _role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE _access_role
    WHEN 'admin' THEN _role = 'admin'
    WHEN 'top_management' THEN _role IN ('top_management', 'top_management_manager')
    WHEN 'controlling' THEN _role IN ('top_management', 'top_management_manager', 'control_finance', 'control_manager', 'finance_manager')
    WHEN 'hr' THEN _role IN ('top_management', 'top_management_manager', 'hr')
    WHEN 'manager' THEN _role IN ('manager', 'back_office_manager')
    WHEN 'housekeeping_manager' THEN _role IN ('manager', 'housekeeping_manager')
    WHEN 'housekeeping_supervisor' THEN _role IN ('manager', 'housekeeping_manager', 'supervisor')
    WHEN 'reception' THEN _role IN ('manager', 'reception', 'front_office', 'reception_manager')
    WHEN 'housekeeping' THEN _role = 'housekeeping'
    WHEN 'maintenance' THEN _role IN ('maintenance', 'maintenance_manager')
    WHEN 'breakfast' THEN _role = 'breakfast_staff'
    WHEN 'other' THEN true
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.effective_access_role(_access_role text, _role text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _access_role IS NOT NULL AND public.access_role_allows_permission(_access_role, _role) THEN _access_role
    ELSE public.access_role_from_permission(_role)
  END
$$;

-- The signed-in person's access role (for RLS helpers and the app).
CREATE OR REPLACE FUNCTION public.current_access_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.effective_access_role(p.access_role, p.role::text)
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.current_access_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_access_role() TO authenticated, service_role;

-- Who may set an access role, and the automatic reset when a legacy screen
-- moves someone to a permission level their access role does not fit.
CREATE OR REPLACE FUNCTION public.guard_profile_access_role()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role text;
  actor_org text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NEW.access_role IS NOT DISTINCT FROM OLD.access_role
     AND NEW.access_role IS NOT NULL
     AND NOT public.access_role_allows_permission(NEW.access_role, NEW.role::text) THEN
    NEW.access_role := NULL;
  END IF;

  IF NEW.access_role IS NOT NULL AND NOT public.access_role_allows_permission(NEW.access_role, NEW.role::text) THEN
    RAISE EXCEPTION 'The role % does not fit the permission level %', NEW.access_role, NEW.role
      USING ERRCODE = '22023';
  END IF;

  IF (TG_OP = 'INSERT' AND NEW.access_role IS NULL)
     OR (TG_OP = 'UPDATE' AND NEW.access_role IS NOT DISTINCT FROM OLD.access_role) THEN
    RETURN NEW;
  END IF;

  -- Edge Functions with the service role, migrations, super administrators.
  IF auth.uid() IS NULL OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- The automatic reset above, after an authorised permission-level change.
  IF TG_OP = 'UPDATE' AND NEW.access_role IS NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  IF NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role' USING ERRCODE = '42501';
  END IF;

  SELECT p.role::text, p.organization_slug INTO actor_role, actor_org
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL;

  IF actor_role IS NULL OR actor_org IS DISTINCT FROM NEW.organization_slug THEN
    RAISE EXCEPTION 'Roles can only be set inside your own organization' USING ERRCODE = '42501';
  END IF;

  IF actor_role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Top management relabels people within their current permission level
  -- (fit checked above). Changing the permission level stays with admins.
  IF actor_role IN ('top_management', 'top_management_manager')
     AND (TG_OP = 'INSERT' OR NEW.role IS NOT DISTINCT FROM OLD.role) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only administrators and top management can set roles' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS profiles_access_role_guard ON public.profiles;
CREATE TRIGGER profiles_access_role_guard
  BEFORE INSERT OR UPDATE OF role, access_role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_access_role();

-- Top management cannot update profiles through RLS, so roles are set through
-- this function. The guard trigger above still decides what is allowed.
CREATE OR REPLACE FUNCTION public.set_staff_access_role(_user_id uuid, _access_role text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role text;
  actor_org text;
  actor_super boolean;
  target_role text;
  target_org text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF _access_role IS NOT NULL AND _access_role NOT IN (
    'admin', 'top_management', 'controlling', 'hr', 'manager', 'housekeeping_manager',
    'housekeeping_supervisor', 'reception', 'housekeeping', 'maintenance', 'breakfast', 'other'
  ) THEN
    RAISE EXCEPTION 'Unknown role %', _access_role USING ERRCODE = '22023';
  END IF;

  SELECT p.role::text, p.organization_slug, coalesce(p.is_super_admin, false)
    INTO actor_role, actor_org, actor_super
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL;

  SELECT p.role::text, p.organization_slug INTO target_role, target_org
    FROM public.profiles p
   WHERE p.id = _user_id AND p.deleted_at IS NULL
   FOR UPDATE;
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'Person not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT actor_super AND NOT (
    actor_org IS NOT DISTINCT FROM target_org
    AND actor_role IN ('admin', 'top_management', 'top_management_manager')
  ) THEN
    RAISE EXCEPTION 'Only administrators and top management can set roles' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET access_role = _access_role WHERE id = _user_id;
  RETURN public.effective_access_role(_access_role, target_role);
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_access_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_access_role(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Work schedule: housekeeping managers / supervisors pinned to their hotel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workforce_access()
RETURNS TABLE(organization_slug text, access_level text, hotel_id text, role text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.organization_slug,
         CASE
           WHEN p.is_super_admin IS TRUE
             OR p.role::text IN ('admin', 'top_management', 'top_management_manager', 'hr') THEN 'org'
           WHEN p.role::text IN ('manager', 'housekeeping_manager', 'maintenance_manager', 'reception_manager',
                                 'back_office_manager', 'finance_manager', 'control_manager', 'marketing_manager') THEN 'property'
           ELSE 'self'
         END,
         CASE
           -- Their team is the hotel of their own work-schedule record, not the
           -- hotel they switched to for the day.
           WHEN p.is_super_admin IS NOT TRUE
            AND public.effective_access_role(p.access_role, p.role::text) IN ('housekeeping_manager', 'housekeeping_supervisor')
           THEN COALESCE(
             (SELECT public.workforce_hotel_key(p.organization_slug, s.hotel_id)
                FROM public.workforce_staff s
               WHERE s.profile_id = p.id
                 AND s.organization_slug = p.organization_slug
                 AND s.is_active
                 AND s.hotel_id IS NOT NULL
               ORDER BY s.updated_at DESC NULLS LAST
               LIMIT 1),
             public.workforce_hotel_key(p.organization_slug, p.assigned_hotel))
           ELSE public.workforce_hotel_key(p.organization_slug, p.assigned_hotel)
         END,
         CASE WHEN p.is_super_admin IS TRUE THEN 'admin' ELSE p.role::text END
    FROM public.profiles p
   WHERE p.id = auth.uid() AND p.deleted_at IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- 3. Staff schedule go-live switch
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workforce_settings (
  organization_slug text PRIMARY KEY,
  staff_schedule_live boolean NOT NULL DEFAULT false,
  staff_schedule_live_changed_at timestamptz,
  staff_schedule_live_changed_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workforce_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workforce settings read own organization" ON public.workforce_settings;
CREATE POLICY "workforce settings read own organization" ON public.workforce_settings
  FOR SELECT TO authenticated
  USING (organization_slug = public.get_user_organization_slug(auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.workforce_settings FROM anon, authenticated;
GRANT SELECT ON public.workforce_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.workforce_staff_schedule_live(_org text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT s.staff_schedule_live FROM public.workforce_settings s WHERE s.organization_slug = _org),
    false)
$$;

-- Housekeepers and maintenance staff see their own schedule only once it is live.
CREATE OR REPLACE FUNCTION public.workforce_self_view_allowed()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT public.effective_access_role(p.access_role, p.role::text) NOT IN ('housekeeping', 'maintenance')
        OR public.workforce_staff_schedule_live(p.organization_slug)
      FROM public.profiles p
     WHERE p.id = auth.uid() AND p.deleted_at IS NULL
  ), false)
$$;

REVOKE ALL ON FUNCTION public.workforce_staff_schedule_live(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workforce_self_view_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workforce_staff_schedule_live(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workforce_self_view_allowed() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_workforce_staff_schedule_live(_live boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_org text;
  actor_level text;
BEGIN
  SELECT a.organization_slug, a.access_level INTO actor_org, actor_level
    FROM public.workforce_access() a
   LIMIT 1;
  IF actor_level IS DISTINCT FROM 'org' OR actor_org IS NULL THEN
    RAISE EXCEPTION 'Only HR, top management or an administrator can put the staff schedule live'
      USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.workforce_settings AS s (
    organization_slug, staff_schedule_live, staff_schedule_live_changed_at, staff_schedule_live_changed_by, updated_at
  ) VALUES (actor_org, coalesce(_live, false), now(), auth.uid(), now())
  ON CONFLICT (organization_slug) DO UPDATE
    SET staff_schedule_live = EXCLUDED.staff_schedule_live,
        staff_schedule_live_changed_at = now(),
        staff_schedule_live_changed_by = auth.uid(),
        updated_at = now();
  RETURN coalesce(_live, false);
END;
$$;

REVOKE ALL ON FUNCTION public.set_workforce_staff_schedule_live(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workforce_staff_schedule_live(boolean) TO authenticated;

-- Same policies as before; only the "my own row / my own published shifts"
-- branch now also needs workforce_self_view_allowed().
DROP POLICY IF EXISTS "workforce read staff" ON public.workforce_staff;
CREATE POLICY "workforce read staff" ON public.workforce_staff
  FOR SELECT TO authenticated
  USING (
    organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
    AND (
      (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'org'
      OR (profile_id = (SELECT auth.uid()) AND public.workforce_self_view_allowed())
      OR (
        (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'property'
        AND (
          hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
          OR public.workforce_staff_works_at(id, (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)))
        )
      )
    )
  );

DROP POLICY IF EXISTS "workforce read entries" ON public.workforce_entries;
CREATE POLICY "workforce read entries" ON public.workforce_entries
  FOR SELECT TO authenticated
  USING (
    organization_slug = (SELECT a.organization_slug FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
    AND (
      (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'org'
      OR (
        (SELECT a.access_level FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role)) = 'property'
        AND (
          hotel_id = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
          OR public.workforce_staff_hotel(staff_id) = (SELECT a.hotel_id FROM public.workforce_access() a(organization_slug, access_level, hotel_id, role))
        )
      )
      OR (status = 'published' AND public.workforce_staff_is_mine(staff_id) AND public.workforce_self_view_allowed())
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Mira approvals with a consent record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assistant_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_slug text NOT NULL,
  hotel_id text NOT NULL,
  thread_id uuid,
  requested_by uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('rate_plan', 'schedule_plan')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 2000),
  plan jsonb NOT NULL,
  plan_hash text NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'applying', 'applied', 'partially_applied', 'failed', 'dismissed', 'expired')),
  approved_items jsonb,
  consent_text text CHECK (consent_text IS NULL OR char_length(consent_text) <= 1000),
  decided_by uuid,
  decided_by_name text,
  decided_by_role text,
  decided_at timestamptz,
  result jsonb,
  error text,
  applied_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_action_requests_decision_complete CHECK (
    status IN ('pending', 'expired') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS assistant_action_requests_requester_idx
  ON public.assistant_action_requests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_action_requests_org_idx
  ON public.assistant_action_requests (organization_slug, created_at DESC);

ALTER TABLE public.assistant_action_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own Mira action requests" ON public.assistant_action_requests;
CREATE POLICY "own Mira action requests" ON public.assistant_action_requests
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR decided_by = auth.uid());

DROP POLICY IF EXISTS "top management reads Mira action requests" ON public.assistant_action_requests;
CREATE POLICY "top management reads Mira action requests" ON public.assistant_action_requests
  FOR SELECT TO authenticated
  USING (
    organization_slug = public.get_user_organization_slug(auth.uid())
    AND (public.is_top_management(auth.uid()) OR public.get_user_role(auth.uid())::text = 'admin')
  );

-- Written only by Edge Functions with the service role.
REVOKE INSERT, UPDATE, DELETE ON public.assistant_action_requests FROM anon, authenticated;
GRANT SELECT ON public.assistant_action_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.assistant_action_requests_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_hash IS DISTINCT FROM OLD.plan_hash
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
     OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'The plan of a Mira request cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF OLD.decided_at IS NOT NULL AND (
       NEW.decided_at IS DISTINCT FROM OLD.decided_at
    OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
    OR NEW.decided_by_name IS DISTINCT FROM OLD.decided_by_name
    OR NEW.decided_by_role IS DISTINCT FROM OLD.decided_by_role
    OR NEW.approved_items IS DISTINCT FROM OLD.approved_items
    OR NEW.consent_text IS DISTINCT FROM OLD.consent_text
  ) THEN
    RAISE EXCEPTION 'A recorded decision cannot be changed' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'dismissed', 'expired'))
    OR (OLD.status = 'approved' AND NEW.status IN ('applying', 'failed'))
    OR (OLD.status = 'applying' AND NEW.status IN ('applied', 'partially_applied', 'failed'))
  ) THEN
    RAISE EXCEPTION 'A Mira request cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '22023';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assistant_action_requests_guard ON public.assistant_action_requests;
CREATE TRIGGER assistant_action_requests_guard
  BEFORE UPDATE ON public.assistant_action_requests
  FOR EACH ROW EXECUTE FUNCTION public.assistant_action_requests_guard();

-- ---------------------------------------------------------------------------
-- 5. Initial roles from the work schedule (owner decision, 17 Nov 2026)
-- ---------------------------------------------------------------------------
-- People on the shared `manager` level get the role of their work-schedule
-- job. Permission levels are not touched.
WITH linked AS (
  SELECT DISTINCT ON (p.id)
         p.id,
         lower(coalesce(jr.name, '')) AS job,
         lower(coalesce(d.name, '')) AS department
    FROM public.profiles p
    JOIN public.workforce_staff s ON s.profile_id = p.id AND s.organization_slug = p.organization_slug AND s.is_active
    LEFT JOIN public.workforce_job_roles jr ON jr.id = s.job_role_id
    LEFT JOIN public.workforce_departments d ON d.id = s.department_id
   WHERE p.deleted_at IS NULL
     AND p.role::text = 'manager'
     AND p.access_role IS NULL
   ORDER BY p.id, s.updated_at DESC NULLS LAST
)
UPDATE public.profiles p
   SET access_role = CASE
         WHEN linked.job LIKE '%housekeeping manager%' THEN 'housekeeping_manager'
         WHEN linked.department LIKE '%housekeeping%' AND linked.job LIKE '%supervisor%' THEN 'housekeeping_supervisor'
         WHEN linked.job LIKE '%front office manager%' OR linked.job LIKE '%reception lead%' THEN 'manager'
         WHEN linked.job LIKE '%receptionist%' THEN 'reception'
       END
  FROM linked
 WHERE p.id = linked.id
   AND (linked.job LIKE '%housekeeping manager%'
        OR (linked.department LIKE '%housekeeping%' AND linked.job LIKE '%supervisor%')
        OR linked.job LIKE '%front office manager%'
        OR linked.job LIKE '%reception lead%'
        OR linked.job LIKE '%receptionist%');

-- Named by the owner: Petra and Klaudia are managers; Laura is Controlling.
UPDATE public.profiles
   SET access_role = 'manager'
 WHERE organization_slug = 'rdhotels' AND deleted_at IS NULL AND role::text = 'manager'
   AND lower(nickname) IN ('petra_006', 'klau_127');

UPDATE public.profiles
   SET access_role = 'controlling'
 WHERE organization_slug = 'rdhotels' AND deleted_at IS NULL AND role::text = 'top_management_manager'
   AND lower(nickname) = 'laura_081';
