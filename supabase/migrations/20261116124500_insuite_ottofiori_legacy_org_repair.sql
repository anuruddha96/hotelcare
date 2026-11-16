-- Repair legacy Previo rows for Hotel Ottofiori without weakening In-Suite
-- tenant isolation. Some older reservations have a NULL organization_slug,
-- so checked-in QR devices cannot bind to them even when the PMS shows arrival.
--
-- Only backfill current/future reservations, and only where BOTH the physical
-- room and the hotel's organization ownership agree on the exact hotel ID.
-- This never changes the reservation status, room, guest or pricing.
UPDATE public.reservations AS stay
SET organization_slug = room.organization_slug
FROM public.rooms AS room
JOIN public.hotel_configurations AS hotel
  ON room.hotel IN (hotel.hotel_id, hotel.hotel_name)
JOIN public.organizations AS owner
  ON owner.id = hotel.organization_id AND owner.slug = room.organization_slug
WHERE stay.room_id = room.id
  AND stay.organization_slug IS NULL
  AND stay.hotel_id = 'ottofiori'
  AND hotel.hotel_id = stay.hotel_id
  AND stay.check_out_date >= (now() AT TIME ZONE 'Europe/Budapest')::date - 1;
