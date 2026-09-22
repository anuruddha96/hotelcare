\set ON_ERROR_STOP on
BEGIN;
INSERT INTO rooms(hotel,organization_slug,room_number,pms_metadata,towel_change_required,linen_change_required,last_towel_change,last_linen_change)
SELECT 'Hotel Memories Budapest','rdhotels',x.room,
  jsonb_build_object('pmsSyncDate', ((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
    'lastPmsRefreshDate', ((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
    'currentNight',x.old_night,'totalNights',x.total_nights,'occupiedToday',true,
    'scheduledDepartureTomorrow',false),
  x.old_towel,x.old_change,'2026-09-17'::date,'2026-09-16'::date
FROM (VALUES ('034',2,3,false,false),('147',4,7,true,false),('308',4,5,false,true),
             ('004',4,5,true,true),('216',4,5,true,true)) AS x(room,old_night,total_nights,old_towel,old_change);
INSERT INTO rooms(hotel,organization_slug,room_number,pms_metadata,towel_change_required,linen_change_required)
VALUES ('Hotel Mika Downtown','rdhotels','101','{}',true,false),
       ('Hotel Memories Budapest','other-tenant','999','{}',true,false),
       ('Hotel Memories Budapest','rdhotels','210',jsonb_build_object(
         'pmsUploadDate',((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
         'lastPmsRefreshDate',((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
         'currentNight',4,'totalNights',7,'occupiedToday',true), false,false);
UPDATE rooms SET
  pms_metadata = pms_metadata || jsonb_build_object(
    'pmsSyncDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
    'lastPmsRefreshDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
    'currentNight',CASE room_number WHEN '034' THEN 3 ELSE 5 END,
    'scheduledDepartureTomorrow',room_number IN ('034','308')),
  is_checkout_room = room_number = '004'
WHERE hotel='Hotel Memories Budapest' AND organization_slug='rdhotels'
  AND room_number IN ('034','147','308','004','216');
UPDATE rooms SET pms_metadata = pms_metadata || jsonb_build_object('isNoShow',true)
WHERE room_number='216' AND organization_slug='rdhotels';
UPDATE rooms SET
 pms_metadata = pms_metadata || jsonb_build_object(
  'pmsUploadDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
  'lastPmsRefreshDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
  'currentNight',5,'totalNights',7,'occupiedToday',true)
WHERE room_number='210' AND hotel='Hotel Memories Budapest' AND organization_slug='rdhotels';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='034' AND towel_change_required AND NOT linen_change_required) THEN
   RAISE EXCEPTION 'Night 3 final night must be towel-only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='147' AND NOT towel_change_required AND linen_change_required) THEN
   RAISE EXCEPTION 'Night 5 of 7 must be Change Room'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='308' AND towel_change_required AND NOT linen_change_required) THEN
   RAISE EXCEPTION 'Night 5 of 5 final-night Change Room must downgrade to towels'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='004' AND NOT towel_change_required AND NOT linen_change_required) THEN
   RAISE EXCEPTION 'Checkout must never get duplicate stayover service'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='216' AND NOT towel_change_required AND NOT linen_change_required) THEN
   RAISE EXCEPTION 'No-show must never get stayover service'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='210' AND linen_change_required AND NOT towel_change_required) THEN
   RAISE EXCEPTION 'Manual XLS must use Memories property cycle'; END IF;
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='101' AND hotel='Hotel Mika Downtown' AND towel_change_required AND NOT linen_change_required) THEN
   RAISE EXCEPTION 'Other hotel was changed'; END IF;
 IF EXISTS(SELECT 1 FROM rooms WHERE organization_slug='rdhotels' AND room_number IN ('034','147','308','004','216')
    AND (last_towel_change <> '2026-09-17'::date OR last_linen_change <> '2026-09-16'::date)) THEN
   RAISE EXCEPTION 'Schedule fabricated an actual service completion'; END IF;
 IF EXISTS(SELECT 1 FROM rooms WHERE pms_metadata ? 'memoriesPmsColumnPresent') THEN
   RAISE EXCEPTION 'Ephemeral internal PMS marker leaked into saved metadata'; END IF;
END $$;
-- Direct room-chip override survives a repeated same-date PMS update, including extensions.
UPDATE rooms SET towel_change_required=false WHERE room_number='034' AND organization_slug='rdhotels';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='034' AND organization_slug='rdhotels'
   AND pms_metadata ->> 'memoriesServiceManualOverrideDate' = (now() AT TIME ZONE 'Europe/Budapest')::date::text)
 THEN RAISE EXCEPTION 'Direct flag edit did not stamp dated override'; END IF;
END $$;
UPDATE rooms SET pms_metadata=pms_metadata||'{"noteOta":"changed note only"}'::jsonb
WHERE room_number='034' AND organization_slug='rdhotels';
UPDATE rooms SET pms_metadata=pms_metadata||'{"currentNight":5,"totalNights":7,"scheduledDepartureTomorrow":false}'::jsonb
WHERE room_number='034' AND organization_slug='rdhotels';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM rooms WHERE room_number='034' AND organization_slug='rdhotels' AND towel_change_required) THEN
  RAISE EXCEPTION 'PMS sync overrode a same-day supervisor change'; END IF;
 IF EXISTS(SELECT 1 FROM rooms WHERE room_number='034' AND organization_slug='rdhotels' AND linen_change_required) THEN
  RAISE EXCEPTION 'Extension overrode a dated manual instruction'; END IF;
END $$;
-- A room without a manual override must recalculate automatically on extension.
UPDATE rooms SET pms_metadata=pms_metadata||'{"totalNights":7,"scheduledDepartureTomorrow":false}'::jsonb
WHERE room_number='308' AND organization_slug='rdhotels';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='308' AND organization_slug='rdhotels' AND linen_change_required AND NOT towel_change_required) THEN
  RAISE EXCEPTION 'Extension without override failed to recalculate'; END IF;
END $$;
-- Manager-only RPC: allowed manager, then forbidden user.
SET app.test_user_id='11111111-1111-4111-8111-111111111111';
SET ROLE authenticated;
SELECT public.hc_save_memories_service_cycle(3,4,5,5,true);
RESET ROLE;
SET app.test_user_id='44444444-4444-4444-8444-444444444444';
SET ROLE authenticated;
DO $$ DECLARE denied boolean := false; BEGIN
 BEGIN PERFORM public.hc_save_memories_service_cycle(3,4,5,5,true);
 EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unauthorised user edited the policy'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
