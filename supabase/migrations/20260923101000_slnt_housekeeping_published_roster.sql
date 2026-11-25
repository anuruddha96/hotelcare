-- Restrict shift editing to SLNT managers/HR. Supervisors retain published HK roster read only.
CREATE OR REPLACE FUNCTION public.can_manage_slnt_schedule(_hotel_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles actor
    JOIN public.organizations org ON org.slug = actor.organization_slug
    JOIN public.hotel_configurations hotel ON hotel.organization_id = org.id
       AND hotel.hotel_id = _hotel_id
    WHERE actor.id = auth.uid() AND actor.deleted_at IS NULL
      AND actor.organization_slug = 'slnt'
      AND actor.role::text IN ('admin','top_management','top_management_manager','manager','housekeeping_manager','hr')
      AND public.user_can_access_hotel(actor.id, _hotel_id)
  );
$fn$;
-- Identity is immutable for SLNT schedules even through direct REST or privileged import.
CREATE OR REPLACE FUNCTION public.slnt_guard_schedule_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.organization_slug = 'slnt' OR NEW.organization_slug = 'slnt' THEN
      IF NEW.organization_slug IS DISTINCT FROM OLD.organization_slug
        OR NEW.hotel_id IS DISTINCT FROM OLD.hotel_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.work_date IS DISTINCT FROM OLD.work_date
      THEN
        RAISE EXCEPTION 'SLNT schedule ownership and work date are immutable' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF NEW.organization_slug = 'slnt' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles employee
      JOIN public.organizations org ON org.slug = employee.organization_slug
      JOIN public.hotel_configurations hotel
        ON hotel.organization_id = org.id AND hotel.hotel_id = NEW.hotel_id
      WHERE employee.id = NEW.user_id AND employee.deleted_at IS NULL
        AND employee.organization_slug = 'slnt'
        AND (employee.hotel_id = NEW.hotel_id OR employee.assigned_hotel IN (NEW.hotel_id,hotel.hotel_name))
    ) OR (NEW.created_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles author WHERE author.id = NEW.created_by
        AND author.organization_slug = 'slnt' AND author.deleted_at IS NULL
    )) OR (NEW.published_by IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.profiles publisher WHERE publisher.id = NEW.published_by
        AND publisher.organization_slug = 'slnt' AND publisher.deleted_at IS NULL
    )) OR length(coalesce(NEW.notes,'')) > 500 THEN
      RAISE EXCEPTION 'Invalid SLNT schedule tenant, employee or author' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS slnt_schedule_identity_guard ON public.staff_schedules;
CREATE TRIGGER slnt_schedule_identity_guard
BEFORE INSERT OR UPDATE ON public.staff_schedules
FOR EACH ROW EXECUTE FUNCTION public.slnt_guard_schedule_identity();

-- SLNT-only published roster for Housekeeping: no drafts, notes or colleagues from other hotels.
-- Does not change the RD Hotels scheduler or the checkout/daily assignment model.
CREATE OR REPLACE FUNCTION public.slnt_housekeeping_published_roster(_hotel text, _day date)
RETURNS TABLE (user_id uuid, shift_start time without time zone, shift_end time without time zone, venue_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' STABLE
AS $fn$
DECLARE
  _caller uuid := auth.uid();
  _scoped boolean;
BEGIN
  IF _caller IS NULL OR _hotel IS NULL OR _day IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles actor
      JOIN public.organizations org ON org.slug = actor.organization_slug
      JOIN public.hotel_configurations hotel ON hotel.organization_id = org.id AND hotel.hotel_id = _hotel
      WHERE actor.id = _caller AND actor.deleted_at IS NULL
        AND actor.organization_slug = 'slnt'
        AND actor.role::text IN ('admin','top_management','top_management_manager','manager','housekeeping_manager','supervisor')
        AND public.user_can_access_hotel(actor.id,_hotel)
    ) THEN
    RAISE EXCEPTION 'Not authorized to read the SLNT housekeeping roster' USING ERRCODE = '42501';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_property_scopes scope
    JOIN public.venues location ON location.id = scope.venue_id
    WHERE scope.user_id = _caller AND scope.organization_slug = 'slnt'
      AND location.organization_slug = 'slnt' AND location.hotel_id = _hotel
  ) INTO _scoped;
  -- Supervisors without explicit venue mapping must not fall back to a full-hotel roster.
  IF NOT _scoped AND EXISTS (
    SELECT 1 FROM public.profiles actor
    WHERE actor.id = _caller AND actor.role::text = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'SLNT supervisor venue access is not configured' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.user_id, s.shift_start, s.shift_end, array_agg(DISTINCT location.id)
    FROM public.staff_schedules s
    JOIN public.profiles employee ON employee.id = s.user_id
    JOIN public.hotel_configurations hotel ON hotel.hotel_id = s.hotel_id
    JOIN public.staff_schedule_venues link ON link.schedule_id = s.id
    JOIN public.venues location ON location.id = link.venue_id
    WHERE s.organization_slug = 'slnt' AND s.hotel_id = _hotel AND s.work_date = _day
      AND s.status = 'published'
      AND employee.organization_slug = 'slnt' AND employee.deleted_at IS NULL
      AND (employee.hotel_id = _hotel OR employee.assigned_hotel IN (_hotel, hotel.hotel_name))
      AND location.organization_slug = 'slnt' AND location.hotel_id = _hotel AND location.is_active
      AND (NOT _scoped OR EXISTS (
        SELECT 1 FROM public.user_property_scopes scope
        WHERE scope.user_id = _caller AND scope.organization_slug = 'slnt'
          AND scope.venue_id = location.id
      ))
    GROUP BY s.id, s.user_id, s.shift_start, s.shift_end;
END;
$fn$;
REVOKE ALL ON FUNCTION public.slnt_housekeeping_published_roster(text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.slnt_housekeeping_published_roster(text,date) TO authenticated;

-- Enforce tenant and property identity even when privileged integrations insert links.
-- The check is SLNT-only; legacy organizations retain their current behaviour.
CREATE OR REPLACE FUNCTION public.slnt_guard_schedule_venue_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.staff_schedules s
    JOIN public.venues v ON v.id = NEW.venue_id
    WHERE s.id = NEW.schedule_id AND s.organization_slug = 'slnt'
      AND (v.organization_slug <> s.organization_slug OR v.hotel_id <> s.hotel_id)
  ) THEN
    RAISE EXCEPTION 'SLNT schedule venue belongs to a different tenant or hotel' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS slnt_schedule_venue_identity_guard ON public.staff_schedule_venues;
CREATE TRIGGER slnt_schedule_venue_identity_guard
BEFORE INSERT OR UPDATE ON public.staff_schedule_venues
FOR EACH ROW EXECUTE FUNCTION public.slnt_guard_schedule_venue_identity();

-- Do not grant TRUNCATE to authenticated clients: PostgreSQL RLS does not govern it.
REVOKE TRUNCATE ON public.staff_schedules, public.staff_schedule_venues FROM anon, authenticated;
