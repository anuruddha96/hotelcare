-- 2026-11-13 incident: full Previo horizon import backfilled ~4,742 historical
-- reservations and the INSERT trigger treated each imported record as a new
-- booking, flooding hotel teams with thousands of push notifications.
--
-- Containment: only manually created / non-Previo new, future-stay bookings
-- can produce the legacy INSERT notification. Keep ALL reservation syncing,
-- reservation-event audits and other push categories running normally.
--
-- Genuine Previo "new booking" push must be restored via the incremental
-- importer using the PMS-native <created> timestamp, a durable dedupe key per
-- PMS reservation, and successful-write-only dispatch. Never re-enable
-- raw AFTER INSERT push for bulk import.
create or replace function public.hotelcare_notify_new_reservation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _users uuid[];
  _org text;
  _hotel text;
  _source text;
  _body text;
begin
  -- The Previo importer inserts historical reservations during horizon sync,
  -- and historical + current ones during incremental sync. Database INSERT
  -- time is not PMS booking creation time.
  if lower(trim(coalesce(new.source, ''))) = 'previo' then
    return new;
  end if;

  -- Independently suppress other historical data loads.
  if new.check_out_date < (now() at time zone 'Europe/Budapest')::date then
    return new;
  end if;

  _org := coalesce(new.organization_slug, 'rdhotels');
  _hotel := new.hotel_id;

  select public.hotelcare_push_recipients(
    _org, _hotel,
    array['manager','admin','top_management','top_management_manager']::text[]
  ) into _users;

  _source := nullif(trim(coalesce(new.source, '')), '');
  _body := case when _source is null then '' else initcap(_source) || ' · ' end ||
    to_char(new.check_in_date, 'DD Mon') || ' → ' || to_char(new.check_out_date, 'DD Mon');

  perform public.hotelcare_dispatch_push(
    _users,
    'New booking',
    _body,
    '/' || _org || '?tab=reservations',
    'reservation-' || new.id::text,
    'new_booking',
    jsonb_build_object(
      'reservationId', new.id,
      'reservationNumber', new.reservation_number,
      'hotelId', new.hotel_id,
      'source', new.source,
      'checkIn', new.check_in_date,
      'checkOut', new.check_out_date
    )
  );

  return new;
end;
$function$;

-- Function is trigger-only, not a callable browser API.
revoke all on function public.hotelcare_notify_new_reservation()
  from public, anon, authenticated;
