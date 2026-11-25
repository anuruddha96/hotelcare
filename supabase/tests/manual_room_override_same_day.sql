-- Disposable PostgreSQL CI only: never run this test against operational rooms.
DO $test$
DECLARE
  room_id uuid := gen_random_uuid();
  stale_room_id uuid := gen_random_uuid();
  day_local date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  stamp text := now()::text;
  r public.rooms%ROWTYPE;
BEGIN
  INSERT INTO public.rooms (id, hotel, organization_slug, is_checkout_room, pms_metadata)
  VALUES (room_id, 'mika-downtown', 'rdhotels', true,
    jsonb_build_object('reservationStatusId','9','scheduledDepartureToday',true,'checkedOutToday',true,'pmsSyncDate',day_local::text));

  -- Manager moves Checkout -> Daily, providing an explicit audit timestamp.
  UPDATE public.rooms SET is_checkout_room=false,
    pms_metadata=pms_metadata || jsonb_build_object('manual_moved_at',stamp,'manual_moved_by','manager-1')
  WHERE id=room_id;
  SELECT * INTO r FROM public.rooms WHERE id=room_id;
  IF r.is_checkout_room OR r.pms_metadata->>'manual_daily' <> 'true'
    OR r.pms_metadata->>'scheduledDepartureToday' <> 'false' THEN
    RAISE EXCEPTION 'Manager selection was not stored as Daily';
  END IF;

  -- An auto refresh can replace the whole JSON document, including markers.
  UPDATE public.rooms SET is_checkout_room=true,
    pms_metadata=jsonb_build_object('reservationStatusId','9','scheduledDepartureToday',true,
      'checkedOutToday',true,'readyToClean',true,'pmsSyncDate',day_local::text,'pmsSource','auto')
  WHERE id=room_id;
  SELECT * INTO r FROM public.rooms WHERE id=room_id;
  IF r.is_checkout_room OR r.pms_metadata->>'manual_daily' <> 'true'
    OR r.pms_metadata->>'manual_moved_at' <> stamp
    OR r.pms_metadata->>'reservationStatusId' <> '9'
    OR r.pms_metadata->>'readyToClean' <> 'false' THEN
    RAISE EXCEPTION 'Auto PMS refresh overrode Daily or lost audit/PMS details';
  END IF;

  -- A person clicking PMS Sync on that same workday is not an override reset.
  UPDATE public.rooms SET is_checkout_room=true,
    pms_metadata=jsonb_build_object('reservationStatusId','9','scheduledDepartureToday',true,
      'checkedOutToday',true,'pmsSyncDate',day_local::text,'pmsSource','manual')
  WHERE id=room_id;
  SELECT * INTO r FROM public.rooms WHERE id=room_id;
  IF r.is_checkout_room OR r.pms_metadata->>'manual_daily' <> 'true' THEN
    RAISE EXCEPTION 'Same-day person-triggered PMS sync undid manager selection';
  END IF;

  -- A new deliberate manager decision can reverse the active override.
  UPDATE public.rooms SET is_checkout_room=true,
    pms_metadata=pms_metadata || jsonb_build_object('manual_moved_at',(now()+interval '1 second')::text)
  WHERE id=room_id;
  SELECT * INTO r FROM public.rooms WHERE id=room_id;
  IF NOT r.is_checkout_room OR r.pms_metadata->>'manual_checkout' <> 'true' THEN
    RAISE EXCEPTION 'Manager cannot reverse Daily to Checkout';
  END IF;

  -- Yesterday's override is carried only until the next workday sync.
  INSERT INTO public.rooms (id, hotel, organization_slug, is_checkout_room, pms_metadata)
  VALUES (stale_room_id,'mika-downtown','rdhotels',false,
    jsonb_build_object('manual_moved_at',(day_local - 1)::text,'manual_daily',true,
      'manual_checkout',false,'pmsSyncDate',(day_local - 1)::text));
  UPDATE public.rooms SET is_checkout_room=true,
    pms_metadata=jsonb_build_object('manual_moved_at',(day_local - 1)::text,'manual_daily',true,
      'manual_checkout',false,'reservationStatusId','9','pmsSyncDate',day_local::text)
  WHERE id=stale_room_id;
  SELECT * INTO r FROM public.rooms WHERE id=stale_room_id;
  IF NOT r.is_checkout_room OR r.pms_metadata ? 'manual_daily' OR r.pms_metadata ? 'manual_moved_at' THEN
    RAISE EXCEPTION 'Yesterday''s manual choice did not expire on next day sync';
  END IF;
  RAISE NOTICE 'PASS manual room-type persistence, both sync sources, reversal, and next-day expiry';
END;
$test$;
