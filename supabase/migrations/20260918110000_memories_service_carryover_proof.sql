-- Hotel Memories Budapest only. This migration performs NO backfill and NO
-- updates to past assignments, existing room records or saved snapshots.
-- Existing hotels retain the legacy completion behaviour until separately migrated.
CREATE TABLE IF NOT EXISTS public.memories_service_carryovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  source_assignment_id uuid NOT NULL UNIQUE REFERENCES public.room_assignments(id),
  source_business_date date NOT NULL,
  incident_type text NOT NULL CHECK (incident_type IN ('dnd', 'no_service')),
  towel_due boolean NOT NULL DEFAULT false,
  linen_due boolean NOT NULL DEFAULT false,
  towel_confirmed_at timestamptz,
  linen_confirmed_at timestamptz,
  incident_resolved_same_day boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memories_service_carryovers_room_date_idx
  ON public.memories_service_carryovers (room_id, source_business_date DESC);
ALTER TABLE public.memories_service_carryovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.memories_service_carryovers FROM anon, authenticated;
GRANT SELECT ON public.memories_service_carryovers TO authenticated;
CREATE POLICY memories_service_carryovers_venue_read
  ON public.memories_service_carryovers FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = room_id
      AND lower(btrim(r.hotel)) IN ('hotel memories budapest', 'memories')
      AND public.user_can_access_hotel(auth.uid(), r.hotel)
      -- Yesterday's incident for a checkout is management-only, including at
      -- the database authorization layer, not just hidden in a React widget.
      AND (
        coalesce(r.is_checkout_room, false) = false
        OR EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
            AND (coalesce(p.is_super_admin, false)
              OR p.role::text IN ('admin', 'manager', 'top_management',
                'top_management_manager', 'housekeeping_manager', 'supervisor'))
        )
      )
  ));

CREATE TABLE IF NOT EXISTS public.memories_textile_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.room_assignments(id),
  room_id uuid NOT NULL REFERENCES public.rooms(id),
  service_type text NOT NULL CHECK (service_type IN ('towel', 'linen')),
  performed_by uuid NOT NULL DEFAULT auth.uid(),
  performed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, service_type)
);
CREATE INDEX IF NOT EXISTS memories_textile_confirmations_room_idx
  ON public.memories_textile_confirmations (room_id, performed_at DESC);
ALTER TABLE public.memories_textile_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.memories_textile_confirmations FROM anon, authenticated;
GRANT SELECT, INSERT ON public.memories_textile_confirmations TO authenticated;
CREATE POLICY memories_textile_confirmations_venue_read
  ON public.memories_textile_confirmations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rooms r WHERE r.id = room_id
      AND lower(btrim(r.hotel)) IN ('hotel memories budapest', 'memories')
      AND public.user_can_access_hotel(auth.uid(), r.hotel)
  ));
CREATE POLICY memories_textile_confirmations_assignee_insert
  ON public.memories_textile_confirmations FOR INSERT TO authenticated
  WITH CHECK (performed_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.room_assignments a
    JOIN public.rooms r ON r.id = a.room_id
    WHERE a.id = assignment_id AND a.room_id = room_id
      AND lower(btrim(r.hotel)) IN ('hotel memories budapest', 'memories')
      AND a.assignment_date = (now() AT TIME ZONE 'Europe/Budapest')::date
      AND a.status::text IN ('in_progress', 'completed')
      AND NOT coalesce(a.is_dnd, false)
      AND coalesce(a.service_result, '') <> 'guest_declined'
      AND coalesce(a.notes, '') NOT LIKE '%[NO_SERVICE]%'
      AND public.user_can_access_hotel(auth.uid(), r.hotel)
      AND (
        a.assigned_to = auth.uid() OR EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
            AND (coalesce(p.is_super_admin, false)
              OR p.role::text IN ('admin', 'manager', 'top_management',
                'top_management_manager', 'housekeeping_manager', 'supervisor'))
        )
      )
  ));

-- The old completion trigger assumes that a scheduled service was performed
-- merely because an assignment reached completed. For Memories, NEVER set
-- last_towel_change / last_linen_change or clear service due from this event.
-- Other properties keep their existing logic byte-for-byte in the fallback.
CREATE OR REPLACE FUNCTION public.check_towel_linen_requirements()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  guest_checkout_date date;
  guest_nights integer;
  v_hotel text;
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    SELECT hotel,
      CASE WHEN is_checkout_room = true THEN checkout_time::date ELSE NULL END,
      coalesce(guest_nights_stayed, 0)
    INTO v_hotel, guest_checkout_date, guest_nights
    FROM public.rooms WHERE id = NEW.room_id;
    IF lower(btrim(coalesce(v_hotel, ''))) IN ('hotel memories budapest', 'memories') THEN
      RETURN NEW;
    END IF;
    IF guest_nights IS NULL THEN guest_nights := 0; END IF;
    UPDATE public.rooms
    SET towel_change_required = CASE
          WHEN guest_checkout_date IS NOT NULL AND guest_nights >= 3 THEN true
          WHEN guest_checkout_date IS NULL AND guest_nights IN (3, 6, 9, 12, 15) THEN true
          ELSE false END,
        linen_change_required = CASE
          WHEN guest_checkout_date IS NOT NULL AND guest_nights >= 5 THEN true
          WHEN guest_checkout_date IS NULL AND guest_nights IN (5, 10, 15, 20) THEN true
          ELSE false END,
        last_towel_change = CASE
          WHEN (guest_checkout_date IS NOT NULL AND guest_nights >= 3)
            OR (guest_checkout_date IS NULL AND guest_nights IN (3, 6, 9, 12, 15))
          THEN CURRENT_DATE ELSE last_towel_change END,
        last_linen_change = CASE
          WHEN (guest_checkout_date IS NOT NULL AND guest_nights >= 5)
            OR (guest_checkout_date IS NULL AND guest_nights IN (5, 10, 15, 20))
          THEN CURRENT_DATE ELSE last_linen_change END,
        updated_at = now()
    WHERE id = NEW.room_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- A dated, immutable account of an actual DND attempt or guest-declined day.
-- Captured at the source event (not by carrying forward yesterday's room flag).
CREATE OR REPLACE FUNCTION public.memories_capture_unserved_service()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_room public.rooms%ROWTYPE;
  v_kind text;
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  IF NEW.assignment_date IS DISTINCT FROM v_today
     OR NEW.assignment_type::text <> 'daily_cleaning' THEN RETURN NEW; END IF;
  SELECT * INTO v_room FROM public.rooms WHERE id = NEW.room_id;
  IF NOT FOUND OR lower(btrim(coalesce(v_room.hotel, '')))
     NOT IN ('hotel memories budapest', 'memories') THEN RETURN NEW; END IF;

  IF NEW.status::text = 'dnd_pending_retry' AND coalesce(NEW.dnd_attempt_count, 0) > 0
     OR (NEW.status::text = 'completed' AND coalesce(NEW.is_dnd, false)
        AND coalesce(NEW.dnd_attempt_count, 0) > 0) THEN
    v_kind := 'dnd';
  ELSIF NEW.status::text = 'completed'
    AND (NEW.service_result = 'guest_declined'
      OR coalesce(NEW.notes, '') LIKE '%[NO_SERVICE]%') THEN
    v_kind := 'no_service';
  ELSE
    -- A genuine later cleaning clears the incident-only outstanding state;
    -- unconfirmed towel/linen obligations remain pending independently.
    IF NEW.status::text = 'completed'
       AND NEW.service_result = 'cleaned' AND NOT coalesce(NEW.is_dnd, false) THEN
      UPDATE public.memories_service_carryovers
      SET incident_resolved_same_day = true
      WHERE room_id = NEW.room_id AND source_business_date = NEW.assignment_date;
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO public.memories_service_carryovers (
    room_id, source_assignment_id, source_business_date, incident_type,
    towel_due, linen_due
  ) VALUES (
    NEW.room_id, NEW.id, NEW.assignment_date, v_kind,
    coalesce(v_room.towel_change_required, false),
    coalesce(v_room.linen_change_required, false)
  ) ON CONFLICT (source_assignment_id) DO UPDATE
    SET towel_due = public.memories_service_carryovers.towel_due OR EXCLUDED.towel_due,
        linen_due = public.memories_service_carryovers.linen_due OR EXCLUDED.linen_due;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS memories_capture_unserved_service ON public.room_assignments;
CREATE TRIGGER memories_capture_unserved_service
AFTER INSERT OR UPDATE OF status, is_dnd, dnd_attempt_count, notes, service_result
ON public.room_assignments FOR EACH ROW
EXECUTE FUNCTION public.memories_capture_unserved_service();

-- Record dates only after an explicit human confirmation from the assignment
-- UI. This trigger cannot run for a DND or guest-declined assignment, another
-- hotel's room, a past assignment, or a mismatched room/assignment pair.
CREATE OR REPLACE FUNCTION public.memories_confirm_textile_service()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_assignment public.room_assignments%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Budapest')::date;
BEGIN
  SELECT * INTO v_assignment FROM public.room_assignments WHERE id = NEW.assignment_id;
  SELECT * INTO v_room FROM public.rooms WHERE id = NEW.room_id;
  IF NOT FOUND OR v_assignment.id IS NULL OR v_assignment.room_id <> NEW.room_id
    OR v_assignment.assignment_date <> v_today
    OR lower(btrim(coalesce(v_room.hotel, ''))) NOT IN ('hotel memories budapest', 'memories')
    OR v_assignment.status::text NOT IN ('in_progress', 'completed')
    OR coalesce(v_assignment.is_dnd, false)
    OR coalesce(v_assignment.service_result, '') = 'guest_declined'
    OR coalesce(v_assignment.notes, '') LIKE '%[NO_SERVICE]%' THEN
    RAISE EXCEPTION 'Textile service must be confirmed on an eligible active Memories assignment';
  END IF;
  IF NEW.performed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Textile confirmation must identify the signed-in user';
  END IF;
  IF NEW.service_type = 'towel' THEN
    UPDATE public.rooms
    SET last_towel_change = v_today, towel_change_required = false, updated_at = now()
    WHERE id = NEW.room_id;
    UPDATE public.memories_service_carryovers SET towel_confirmed_at = now()
      WHERE room_id = NEW.room_id AND towel_due AND towel_confirmed_at IS NULL
        AND source_business_date <= v_today;
  ELSE
    UPDATE public.rooms
    SET last_linen_change = v_today, linen_change_required = false, updated_at = now()
    WHERE id = NEW.room_id;
    UPDATE public.memories_service_carryovers SET linen_confirmed_at = now()
      WHERE room_id = NEW.room_id AND linen_due AND linen_confirmed_at IS NULL
        AND source_business_date <= v_today;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS memories_confirm_textile_service ON public.memories_textile_confirmations;
CREATE TRIGGER memories_confirm_textile_service
AFTER INSERT ON public.memories_textile_confirmations FOR EACH ROW
EXECUTE FUNCTION public.memories_confirm_textile_service();
