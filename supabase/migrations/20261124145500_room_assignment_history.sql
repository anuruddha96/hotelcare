-- Append-only ownership audit, separate from room service snapshots.
CREATE TABLE public.room_assignment_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_slug text NOT NULL,
  hotel text NOT NULL,
  room_id uuid NOT NULL,
  room_number text NOT NULL,
  assignment_id uuid NOT NULL,
  assignment_date date NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL CHECK (event_type IN ('assigned','reassigned','unassigned')),
  previous_assignee_id uuid,
  previous_assignee_name text,
  new_assignee_id uuid,
  new_assignee_name text,
  actor_id uuid,
  actor_name text
);
CREATE INDEX room_assignment_history_scope_day_idx ON public.room_assignment_history
  (organization_slug, hotel, assignment_date, occurred_at DESC, id DESC);
CREATE INDEX room_assignment_history_room_day_idx ON public.room_assignment_history
  (organization_slug, hotel, room_number, assignment_date, occurred_at DESC, id DESC);
ALTER TABLE public.room_assignment_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_assignment_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.room_assignment_history TO authenticated;
CREATE POLICY "Housekeeping managers can read authorized assignment history"
  ON public.room_assignment_history FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL AND (
      public.is_super_admin(auth.uid()) OR (
        organization_slug = public.get_user_organization_slug(auth.uid())
        AND public.get_user_role(auth.uid())::text IN
          ('admin','top_management','top_management_manager','manager','housekeeping_manager')
        AND public.user_can_access_hotel(auth.uid(), hotel)
      )
    )
  );

-- Actual authenticated actor, never the mutable assigned_by field. Calls
-- without a user JWT are recorded as system/unknown, not attributed to staff.
-- SECURITY DEFINER is necessary because clients have no INSERT permission.
CREATE FUNCTION public.capture_room_assignment_ownership_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_old public.room_assignments%ROWTYPE;
  v_new public.room_assignments%ROWTYPE;
  v_row public.room_assignments%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_event text;
  v_previous uuid;
  v_next uuid;
  v_actor uuid := auth.uid();
  v_split boolean := false;
  v_phase integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := OLD; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    v_split := (OLD.room_id, OLD.assignment_date, OLD.organization_slug)
      IS DISTINCT FROM (NEW.room_id, NEW.assignment_date, NEW.organization_slug);
    IF NOT v_split AND OLD.assigned_to IS NOT DISTINCT FROM NEW.assigned_to THEN
      RETURN NEW;
    END IF;
  END IF;
  FOR v_phase IN 1..(CASE WHEN v_split THEN 2 ELSE 1 END) LOOP
    v_previous := NULL;
    v_next := NULL;
    IF TG_OP = 'DELETE' OR (v_split AND v_phase = 1) THEN
      v_row := v_old;
      v_previous := v_old.assigned_to;
      v_event := 'unassigned';
    ELSIF TG_OP = 'INSERT' OR v_split THEN
      v_row := v_new;
      v_next := v_new.assigned_to;
      v_event := 'assigned';
    ELSE
      v_row := v_new;
      v_previous := v_old.assigned_to;
      v_next := v_new.assigned_to;
      v_event := 'reassigned';
    END IF;
    -- The room's organization and property are authoritative. Ignore orphaned
    -- legacy records/cascading room deletion rather than leaking another tenant.
    SELECT * INTO v_room FROM public.rooms WHERE id = v_row.room_id
      AND organization_slug = v_row.organization_slug;
    IF NOT FOUND THEN CONTINUE; END IF;
    INSERT INTO public.room_assignment_history (
      organization_slug, hotel, room_id, room_number, assignment_id,
      assignment_date, event_type, previous_assignee_id, previous_assignee_name,
      new_assignee_id, new_assignee_name, actor_id, actor_name
    ) VALUES (
      v_room.organization_slug, v_room.hotel, v_room.id, v_room.room_number,
      v_row.id, v_row.assignment_date, v_event, v_previous,
      (SELECT full_name FROM public.profiles WHERE id = v_previous AND organization_slug = v_room.organization_slug),
      v_next,
      (SELECT full_name FROM public.profiles WHERE id = v_next AND organization_slug = v_room.organization_slug),
      v_actor,
      (SELECT full_name FROM public.profiles WHERE id = v_actor AND
        (organization_slug = v_room.organization_slug OR is_super_admin IS TRUE))
    );
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_room_assignment_ownership_event() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER room_assignment_ownership_audit
AFTER INSERT OR UPDATE OR DELETE ON public.room_assignments
FOR EACH ROW EXECUTE FUNCTION public.capture_room_assignment_ownership_event();

-- No synthetic backfill: prior owners and actors were not reliably captured.
