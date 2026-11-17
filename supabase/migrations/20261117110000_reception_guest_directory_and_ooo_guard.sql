-- 1) Check-out must not put an out-of-order / maintenance room back into the
--    cleaning cycle. Those two statuses are only ever left by a person.
CREATE OR REPLACE FUNCTION public.pms_check_out_reservation(_reservation_id uuid, _acknowledge_balance boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  r public.reservations%rowtype;
  bal numeric;
begin
  select * into r from public.reservations where id=_reservation_id for update;
  if not found then raise exception 'RESERVATION_NOT_FOUND'; end if;
  if _uid is not null and not public.can_access_pms_hotel(_uid,r.hotel_id,r.organization_slug) then raise exception 'ACCESS_DENIED'; end if;
  if r.status <> 'checked_in' then raise exception 'INVALID_STATUS'; end if;
  bal := coalesce(r.balance_due,0);
  if bal > 0 and not _acknowledge_balance then raise exception 'BALANCE_DUE'; end if;

  update public.reservations set status='checked_out', actual_check_out=now() where id=r.id;
  if r.room_id is not null then
    update public.rooms
       set status = case when status in ('out_of_order','maintenance') then status else 'dirty' end,
           is_checkout_room=true, checkout_time=now(), guest_count=0, updated_at=now()
     where id=r.room_id;
  end if;
  update public.reservation_room_assignments set status='completed' where reservation_id=r.id and status in ('assigned','active');
  insert into public.reservation_events(reservation_id,hotel_id,organization_slug,event_type,metadata,created_by)
  values(r.id,r.hotel_id,r.organization_slug,'check_out',jsonb_build_object('balance_at_checkout',bal,'balance_acknowledged',_acknowledge_balance),_uid);
  return jsonb_build_object('ok',true,'reservation_id',r.id,'balance_at_checkout',bal);
end;
$function$;

-- 2) Guest directory. Hotels on an external PMS (Previo) have thousands of
--    bookings but no guest rows, so the directory was empty. Instead of copying
--    every booker into a second table (storage + a write on every import), the
--    directory is read straight from the bookings:
--      * a saved guest profile (guests row) with its linked stays, or
--      * a guest derived from bookings that share the same name at one hotel.
--    Nothing is written. SECURITY INVOKER: the caller's RLS decides what is seen.
CREATE OR REPLACE FUNCTION public.pms_guest_directory(_hotel_ids text[], _term text DEFAULT NULL, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  WITH needle AS (
    SELECT CASE WHEN length(trim(coalesce(_term, ''))) >= 2
      THEN '%' || replace(replace(replace(trim(_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' END AS p
  ),
  res AS (
    SELECT r.id, r.hotel_id, r.guest_id, r.reservation_number, r.status,
           r.check_in_date::date AS ci, r.check_out_date::date AS co,
           r.total_amount, r.currency, rm.room_number,
           nullif(trim(regexp_replace(coalesce(r.pms_guest_name, r.pms_contact_name, ''), '\s+', ' ', 'g')), '') AS nm,
           nullif(trim(r.pms_contact_email), '') AS email,
           nullif(trim(r.pms_contact_phone), '') AS phone,
           coalesce(nullif(trim(r.ota_name), ''), nullif(trim(r.pms_channel), ''), r.source) AS channel
    FROM reservations r
    LEFT JOIN rooms rm ON rm.id = r.room_id
    WHERE r.hotel_id = ANY(_hotel_ids)
      AND r.pms_missing_since IS NULL
      AND r.status NOT IN ('cancelled', 'no_show')
  ),
  stays AS (
    SELECT hotel_id, guest_id, CASE WHEN guest_id IS NULL THEN lower(nm) END AS name_key,
           max(nm) AS nm,
           count(*) AS stays,
           sum(greatest(co - ci, 0)) AS nights,
           min(ci) AS first_stay,
           max(co) AS last_stay,
           min(ci) FILTER (WHERE ci >= current_date AND status IN ('pending', 'confirmed')) AS next_arrival,
           bool_or(status = 'checked_in') AS in_house,
           sum(total_amount) AS spend,
           max(currency) AS currency,
           (array_agg(email ORDER BY ci DESC) FILTER (WHERE email IS NOT NULL))[1] AS email,
           (array_agg(phone ORDER BY ci DESC) FILTER (WHERE phone IS NOT NULL))[1] AS phone,
           array_agg(DISTINCT channel) FILTER (WHERE channel IS NOT NULL) AS channels,
           (jsonb_agg(jsonb_build_object(
              'id', id, 'reservation_number', reservation_number, 'status', status,
              'check_in_date', ci, 'check_out_date', co, 'room_number', room_number,
              'channel', channel, 'total_amount', total_amount, 'currency', currency) ORDER BY ci DESC)) AS stay_list
    FROM res
    WHERE guest_id IS NOT NULL OR nm IS NOT NULL
    GROUP BY hotel_id, guest_id, CASE WHEN guest_id IS NULL THEN lower(nm) END
  ),
  directory AS (
    -- Saved profiles (with or without stays).
    SELECT 'profile' AS kind, g.id::text AS key, g.id AS guest_id, g.hotel_id,
           trim(coalesce(g.first_name, '') || ' ' || coalesce(g.last_name, '')) AS name,
           coalesce(g.email, s.email) AS email, coalesce(g.phone, s.phone) AS phone,
           g.nationality, g.vip_status, g.company_name, g.preferences,
           coalesce(s.stays, 0) AS stays, coalesce(s.nights, 0) AS nights,
           s.first_stay, s.last_stay, s.next_arrival, coalesce(s.in_house, false) AS in_house,
           s.spend, s.currency, s.channels, s.stay_list
    FROM guests g
    LEFT JOIN stays s ON s.guest_id = g.id
    WHERE g.hotel_id = ANY(_hotel_ids)
    UNION ALL
    -- Guests known only from bookings (external PMS).
    SELECT 'bookings', md5(s.hotel_id || '|' || s.name_key), NULL, s.hotel_id,
           s.nm, s.email, s.phone, NULL, NULL, NULL, NULL,
           s.stays, s.nights, s.first_stay, s.last_stay, s.next_arrival, s.in_house,
           s.spend, s.currency, s.channels, s.stay_list
    FROM stays s
    WHERE s.guest_id IS NULL
  )
  SELECT to_jsonb(d.*) || jsonb_build_object('total_count', count(*) OVER ())
  FROM directory d CROSS JOIN needle n
  WHERE n.p IS NULL OR d.name ILIKE n.p OR d.email ILIKE n.p OR d.phone ILIKE n.p
  ORDER BY d.in_house DESC, d.next_arrival NULLS LAST, d.last_stay DESC NULLS LAST, d.name
  LIMIT least(greatest(coalesce(_limit, 50), 1), 200) OFFSET greatest(coalesce(_offset, 0), 0);
$fn$;

GRANT EXECUTE ON FUNCTION public.pms_guest_directory(text[], text, int, int) TO authenticated;
