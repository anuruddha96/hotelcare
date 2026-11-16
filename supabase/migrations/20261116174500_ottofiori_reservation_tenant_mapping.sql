-- Hotel Ottofiori: imported legacy Previo reservations sometimes arrive
-- without organization_slug even when their physical room belongs to RD Hotels.
-- In-Suite requires an exact tenant match before identifying the active guest.
--
-- Fix only unowned Ottofiori bookings with an unambiguous, canonical room ->
-- property -> organization mapping. Never override an existing tenant value,
-- and never alter guests, room assignment, status, dates, financials or rates.
CREATE OR REPLACE FUNCTION public.ottofiori_fill_reservation_organization()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  matched_slug text;
BEGIN
  IF NEW.organization_slug IS NOT NULL
     OR NEW.hotel_id IS DISTINCT FROM 'ottofiori'
     OR NEW.room_id IS NULL
  THEN
    RETURN NEW;
  END IF;
  SELECT r.organization_slug INTO matched_slug
    FROM public.rooms r
    JOIN public.hotel_configurations h ON h.hotel_id = NEW.hotel_id
       AND r.hotel = ANY(ARRAY[h.hotel_id, h.hotel_name])
    JOIN public.organizations o ON o.id = h.organization_id
       AND o.slug = r.organization_slug
   WHERE r.id = NEW.room_id AND r.organization_slug IS NOT NULL
   LIMIT 1;
  IF matched_slug IS NOT NULL THEN
    NEW.organization_slug := matched_slug;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ottofiori_fill_reservation_organization()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ottofiori_reservation_org_fill ON public.reservations;
CREATE TRIGGER ottofiori_reservation_org_fill
BEFORE INSERT OR UPDATE OF hotel_id, room_id, organization_slug, status, check_in_date, check_out_date
ON public.reservations FOR EACH ROW
EXECUTE FUNCTION public.ottofiori_fill_reservation_organization();

-- Existing arrivals/active/future guests must also become eligible immediately.
UPDATE public.reservations AS stay
SET organization_slug = room.organization_slug
FROM public.rooms AS room
JOIN public.hotel_configurations AS hotel
  ON room.hotel IN (hotel.hotel_id, hotel.hotel_name)
JOIN public.organizations AS owner
  ON owner.id = hotel.organization_id
 AND owner.slug = room.organization_slug
WHERE stay.room_id = room.id
  AND stay.organization_slug IS NULL
  AND stay.hotel_id = 'ottofiori'
  AND hotel.hotel_id = stay.hotel_id
  AND stay.check_out_date >= (now() AT TIME ZONE 'Europe/Budapest')::date;
