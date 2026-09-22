-- #348 security audit found historical cross-tenant live room assignments.
-- Do not delete/reassign historical work silently. Scope reads and all writes
-- to the caller's organization; validate NEW worker/room references on INSERT
-- and only when their identities change on UPDATE, so previously mislinked
-- in-progress records can still be completed while managers reconcile them.
-- SECURITY DEFINER and a pinned search_path make the trigger see the actual
-- organization of the target room/worker, rather than depending on caller RLS.

CREATE POLICY "Room assignments universally restricted to caller organization"
ON public.room_assignments AS RESTRICTIVE
FOR ALL TO authenticated
USING (
  public.is_super_admin((SELECT auth.uid()))
  OR organization_slug = public.get_user_organization_slug((SELECT auth.uid()))
)
WITH CHECK (
  public.is_super_admin((SELECT auth.uid()))
  OR organization_slug = public.get_user_organization_slug((SELECT auth.uid()))
);

CREATE OR REPLACE FUNCTION public.enforce_room_assignment_tenant_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  check_room boolean;
  check_worker boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    check_room := true;
    check_worker := true;
  ELSE
    check_room := NEW.room_id IS DISTINCT FROM OLD.room_id
      OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug;
    check_worker := NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
      OR NEW.organization_slug IS DISTINCT FROM OLD.organization_slug;
  END IF;

  IF check_room AND NOT EXISTS (
    SELECT 1 FROM public.rooms room
    WHERE room.id = NEW.room_id AND room.organization_slug = NEW.organization_slug
  ) THEN
    RAISE EXCEPTION 'Cannot assign a room outside the selected organization'
      USING ERRCODE = '23514';
  END IF;

  IF check_worker AND NOT EXISTS (
    SELECT 1 FROM public.profiles worker
    WHERE worker.id = NEW.assigned_to
      AND worker.organization_slug = NEW.organization_slug
      AND worker.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot assign staff outside the selected organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_room_assignment_tenant_integrity_trigger
  ON public.room_assignments;
CREATE TRIGGER enforce_room_assignment_tenant_integrity_trigger
BEFORE INSERT OR UPDATE ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.enforce_room_assignment_tenant_integrity();
