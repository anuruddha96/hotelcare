-- Follow-up refinement for #348: inserts and updates must be tenant-safe,
-- while reading/deleting historic staff records must not fail when a former
-- employee has subsequently been deleted.
DROP POLICY IF EXISTS "Plan staff writes require same organization"
ON public.next_day_housekeeping_plan_staff;

CREATE POLICY "Plan staff inserts require same organization"
ON public.next_day_housekeeping_plan_staff AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.profiles worker ON worker.id = user_id
  WHERE plan.id = plan_id
    AND worker.organization_slug = plan.organization_slug
    AND worker.deleted_at IS NULL
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
));

CREATE POLICY "Plan staff updates require same organization"
ON public.next_day_housekeeping_plan_staff AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.profiles worker ON worker.id = user_id
  WHERE plan.id = plan_id
    AND worker.organization_slug = plan.organization_slug
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.profiles worker ON worker.id = user_id
  WHERE plan.id = plan_id
    AND worker.organization_slug = plan.organization_slug
    AND worker.deleted_at IS NULL
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
));

DROP POLICY IF EXISTS "Plan item updates require same organization and property"
ON public.next_day_housekeeping_plan_items;
CREATE POLICY "Plan item updates require same organization and property"
ON public.next_day_housekeeping_plan_items AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.next_day_housekeeping_plans plan
  JOIN public.rooms room ON room.id = room_id
  WHERE plan.id = plan_id
    AND room.organization_slug = plan.organization_slug
    AND (
      room.hotel = plan.hotel_id
      OR public.get_hotel_name_from_id(plan.hotel_id) = room.hotel
      OR public.get_hotel_name_from_id(room.hotel) = plan.hotel_id
      OR EXISTS (
        SELECT 1 FROM public.hotel_configurations hc
        JOIN public.organizations org ON org.id = hc.organization_id
        WHERE org.slug = plan.organization_slug
          AND (hc.hotel_id = plan.hotel_id OR hc.hotel_name = plan.hotel_id)
          AND (hc.hotel_id = room.hotel OR hc.hotel_name = room.hotel)
      )
    )
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
    AND (
      room.hotel = plan.hotel_id
      OR public.get_hotel_name_from_id(plan.hotel_id) = room.hotel
      OR public.get_hotel_name_from_id(room.hotel) = plan.hotel_id
      OR EXISTS (
        SELECT 1 FROM public.hotel_configurations hc
        JOIN public.organizations org ON org.id = hc.organization_id
        WHERE org.slug = plan.organization_slug
          AND (hc.hotel_id = plan.hotel_id OR hc.hotel_name = plan.hotel_id)
          AND (hc.hotel_id = room.hotel OR hc.hotel_name = room.hotel)
      )
    )
    AND public.can_manage_next_day_housekeeping_plan(plan.organization_slug,plan.hotel_id)
));
