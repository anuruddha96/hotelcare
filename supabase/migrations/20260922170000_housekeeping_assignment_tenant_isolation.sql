-- #348: assignment_patterns previously permitted every manager to read/write
-- every tenant's history. Enforce organization AND authorized property at RLS.
-- The historic data is not deleted; only its visibility changes.
-- Preserve authorized top management and explicit super-admin access, while
-- reusing the established organization/property authorization helper.
DROP POLICY IF EXISTS "Managers and admins can view assignment patterns" ON public.assignment_patterns;
DROP POLICY IF EXISTS "Managers and admins can insert assignment patterns" ON public.assignment_patterns;
DROP POLICY IF EXISTS "Managers and admins can update assignment patterns" ON public.assignment_patterns;

CREATE POLICY "Assignment patterns scoped read" ON public.assignment_patterns
FOR SELECT TO authenticated USING (
  (public.is_super_admin((SELECT auth.uid())) OR (
    public.get_user_role((SELECT auth.uid())) IN (
      'manager'::public.user_role, 'housekeeping_manager'::public.user_role,
      'admin'::public.user_role, 'top_management'::public.user_role,
      'top_management_manager'::public.user_role
    )
    AND public.can_manage_next_day_housekeeping_plan(organization_slug, hotel)
  ))
);
CREATE POLICY "Assignment patterns scoped insert" ON public.assignment_patterns
FOR INSERT TO authenticated WITH CHECK (
  (public.is_super_admin((SELECT auth.uid())) OR (
    public.get_user_role((SELECT auth.uid())) IN (
      'manager'::public.user_role, 'housekeeping_manager'::public.user_role,
      'admin'::public.user_role, 'top_management'::public.user_role,
      'top_management_manager'::public.user_role
    )
    AND public.can_manage_next_day_housekeeping_plan(organization_slug, hotel)
  ))
);
CREATE POLICY "Assignment patterns scoped update" ON public.assignment_patterns
FOR UPDATE TO authenticated
USING (
  (public.is_super_admin((SELECT auth.uid())) OR (
    public.get_user_role((SELECT auth.uid())) IN (
      'manager'::public.user_role, 'housekeeping_manager'::public.user_role,
      'admin'::public.user_role, 'top_management'::public.user_role,
      'top_management_manager'::public.user_role
    )
    AND public.can_manage_next_day_housekeeping_plan(organization_slug, hotel)
  ))
)
WITH CHECK (
  (public.is_super_admin((SELECT auth.uid())) OR (
    public.get_user_role((SELECT auth.uid())) IN (
      'manager'::public.user_role, 'housekeeping_manager'::public.user_role,
      'admin'::public.user_role, 'top_management'::public.user_role,
      'top_management_manager'::public.user_role
    )
    AND public.can_manage_next_day_housekeeping_plan(organization_slug, hotel)
  ))
);

-- Existing plan-item UPDATE policy validated organization but not the hotel's
-- room ownership. Restrictive policy is AND-ed with all permissive policies.
CREATE POLICY "Plan item updates require same organization and property"
ON public.next_day_housekeeping_plan_items AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.rooms room ON room.id = room_id
  WHERE plan.id = plan_id
    AND plan.organization_slug = room.organization_slug
    AND (room.hotel = plan.hotel_id OR public.get_hotel_name_from_id(plan.hotel_id) = room.hotel)
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.rooms room ON room.id = room_id
  JOIN public.profiles worker ON worker.id = assigned_to
  WHERE plan.id = plan_id
    AND room.organization_slug = plan.organization_slug
    AND worker.organization_slug = plan.organization_slug
    AND worker.deleted_at IS NULL
    AND (room.hotel = plan.hotel_id OR public.get_hotel_name_from_id(plan.hotel_id) = room.hotel)
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
));

-- A plan's staff rows cannot reference employees from a different organization.
CREATE POLICY "Plan staff writes require same organization"
ON public.next_day_housekeeping_plan_staff AS RESTRICTIVE
FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.profiles worker ON worker.id = user_id
  WHERE plan.id = plan_id AND worker.organization_slug = plan.organization_slug
    AND worker.deleted_at IS NULL
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.profiles worker ON worker.id = user_id
  WHERE plan.id = plan_id AND worker.organization_slug = plan.organization_slug
    AND worker.deleted_at IS NULL
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
));

-- Prevent duplicate primary owners for a room, while preserving explicit
-- primary+helper shared-room assignments (the existing composite key permits
-- multiple primary owners). Check before applying on existing data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.next_day_housekeeping_plan_items
    WHERE COALESCE(recommendation_context->>'assignment_role','primary') <> 'shared'
    GROUP BY plan_id,room_id HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS next_day_hk_one_primary_per_room_idx
      ON public.next_day_housekeeping_plan_items(plan_id,room_id)
      WHERE COALESCE(recommendation_context->>'assignment_role','primary') <> 'shared';
  ELSE
    RAISE NOTICE 'Existing duplicate primary next-day assignments require cleanup; unique index was not created.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assignment_patterns_tenant_hotel_recent_idx
  ON public.assignment_patterns (organization_slug,hotel,last_seen_at DESC);
