-- Reception quick search across ALL dates (the UI only loads -45d..+210d,
-- so a direct booking far in the future was unfindable from the search box).
-- Searched fields, in ranking order: guest passport / ID document number,
-- reservation number, room number, guest name (then email, phone, PMS fields).
-- SECURITY INVOKER: the caller's RLS on reservations/guests/rooms applies.
CREATE OR REPLACE FUNCTION public.pms_reservation_search(_hotel_ids text[], _term text)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH needle AS (
    SELECT '%' || replace(replace(replace(trim(_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS p
  )
  SELECT to_jsonb(r.*)
    || jsonb_build_object(
      'guests', CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object(
        'first_name', g.first_name, 'last_name', g.last_name,
        'email', g.email, 'phone', g.phone, 'vip_status', g.vip_status,
        'id_document_number', g.id_document_number) END,
      'rooms', CASE WHEN rm.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', rm.id, 'room_number', rm.room_number, 'room_type', rm.room_type, 'status', rm.status) END)
  FROM reservations r
  LEFT JOIN guests g ON g.id = r.guest_id
  LEFT JOIN rooms rm ON rm.id = r.room_id
  CROSS JOIN needle n
  WHERE r.hotel_id = ANY(_hotel_ids)
    AND length(trim(coalesce(_term, ''))) >= 2
    AND r.pms_missing_since IS NULL
    AND (
      g.id_document_number ILIKE n.p
      OR r.reservation_number ILIKE n.p
      OR rm.room_number ILIKE n.p
      OR g.first_name ILIKE n.p
      OR g.last_name ILIKE n.p
      OR (g.first_name || ' ' || g.last_name) ILIKE n.p
      OR g.email ILIKE n.p
      OR g.phone ILIKE n.p
      OR r.pms_guest_name ILIKE n.p
      OR r.pms_voucher ILIKE n.p
      OR r.pms_reservation_id ILIKE n.p
      OR r.source_reservation_id ILIKE n.p
      OR r.pms_contact_name ILIKE n.p
      OR r.pms_contact_email ILIKE n.p
    )
  ORDER BY
    coalesce(g.id_document_number ILIKE n.p, false) DESC,
    coalesce(r.reservation_number ILIKE n.p, false) DESC,
    coalesce(rm.room_number ILIKE n.p, false) DESC,
    CASE WHEN r.status = 'checked_in' THEN 0
         WHEN r.status IN ('pending', 'confirmed') THEN 1
         ELSE 2 END,
    r.check_in_date
  LIMIT 20;
$fn$;

GRANT EXECUTE ON FUNCTION public.pms_reservation_search(text[], text) TO authenticated;
