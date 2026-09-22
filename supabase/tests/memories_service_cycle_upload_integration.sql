\set ON_ERROR_STOP on
BEGIN;
-- A legacy XLS enters day-five stayover without the live API occupiedToday.
INSERT INTO rooms(hotel,organization_slug,room_number,pms_metadata,towel_change_required,linen_change_required,last_towel_change,last_linen_change)
VALUES ('Hotel Memories Budapest','rdhotels','147', jsonb_build_object(
  'pmsUploadDate',((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
  'lastPmsRefreshDate',((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
  'currentNight',4,'totalNights',7), false,false,'2026-09-15','2026-09-14');
UPDATE rooms SET
 pms_metadata=pms_metadata||jsonb_build_object(
  'pmsUploadDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
  'lastPmsRefreshDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
  'currentNight',5,'totalNights',7),
 towel_change_required=true, linen_change_required=false,
 last_towel_change=(now() AT TIME ZONE 'Europe/Budapest')::date,
 last_linen_change=(now() AT TIME ZONE 'Europe/Budapest')::date
WHERE room_number='147' AND organization_slug='rdhotels';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='147' AND linen_change_required
   AND NOT towel_change_required AND last_towel_change='2026-09-15'
   AND last_linen_change='2026-09-14'
   AND pms_metadata ->> 'occupiedToday'='true')
 THEN RAISE EXCEPTION 'Legacy XLS did not normalize and compute C without fake completion'; END IF;
END $$;
-- Repeated identical XLS metadata must not be misclassified as a manual edit.
UPDATE rooms SET pms_metadata=pms_metadata,
 towel_change_required=true, linen_change_required=false,
 last_towel_change=(now() AT TIME ZONE 'Europe/Budapest')::date,
 last_linen_change=(now() AT TIME ZONE 'Europe/Budapest')::date
WHERE room_number='147' AND organization_slug='rdhotels';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='147' AND linen_change_required
   AND NOT towel_change_required AND last_towel_change='2026-09-15'
   AND last_linen_change='2026-09-14'
   AND NOT pms_metadata ? 'memoriesPmsColumnPresent')
 THEN RAISE EXCEPTION 'Repeated XLS overwrote correct service flag or fabricated date'; END IF;
END $$;
-- Direct manual changes and their day-local marker survive a repeated XLS.
UPDATE rooms SET towel_change_required=true,linen_change_required=false
WHERE room_number='147' AND organization_slug='rdhotels';
UPDATE rooms SET pms_metadata=pms_metadata,
 towel_change_required=false,linen_change_required=true
WHERE room_number='147' AND organization_slug='rdhotels';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='147' AND towel_change_required
   AND NOT linen_change_required
   AND pms_metadata ->> 'memoriesServiceManualOverrideDate'=(now() AT TIME ZONE 'Europe/Budapest')::date::text)
 THEN RAISE EXCEPTION 'Repeated XLS overwrote a confirmed same-day supervisor override'; END IF;
END $$;
-- Verify other-tenant room bearing same hotel label remains completely untouched.
INSERT INTO rooms(hotel,organization_slug,room_number,pms_metadata,towel_change_required,linen_change_required)
VALUES('Hotel Memories Budapest','other-tenant','999',jsonb_build_object(
 'pmsUploadDate',((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
 'lastPmsRefreshDate',((now() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
 'currentNight',4,'totalNights',7),false,false);
UPDATE rooms SET pms_metadata=pms_metadata||jsonb_build_object(
 'pmsUploadDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
 'lastPmsRefreshDate',(now() AT TIME ZONE 'Europe/Budapest')::date::text,
 'currentNight',5), towel_change_required=true, linen_change_required=false
WHERE room_number='999' AND organization_slug='other-tenant';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM rooms WHERE room_number='999' AND towel_change_required AND NOT linen_change_required
   AND NOT pms_metadata ? 'memoriesServiceManualOverrideDate')
 THEN RAISE EXCEPTION 'Foreign tenant was modified'; END IF;
END $$;
-- Old XLS code resets every room before reading or verifying rows. Protect
-- a multi-room current shift from silent zeroing even if legacy browser open.
INSERT INTO rooms(hotel,organization_slug,room_number,pms_metadata,towel_change_required,is_checkout_room)
SELECT 'Hotel Memories Budapest','rdhotels','x'||n::text,'{}',true,true
FROM generate_series(1,7) n;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  UPDATE rooms SET towel_change_required=false,linen_change_required=false
  WHERE hotel='Hotel Memories Budapest' AND organization_slug='rdhotels';
 EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Mass flag reset was not blocked'; END IF;
END $$;
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  UPDATE rooms SET is_checkout_room=false
  WHERE hotel='Hotel Memories Budapest' AND organization_slug='rdhotels';
 EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Mass checkout reset was not blocked'; END IF;
END $$;
INSERT INTO room_assignments(room_id, assignment_date, status)
SELECT id,(now() AT TIME ZONE 'Europe/Budapest')::date,'assigned'
FROM rooms WHERE organization_slug='rdhotels' AND room_number IN ('x1','x2','x3');
DO $$ DECLARE denied boolean:=false; BEGIN
 BEGIN
  DELETE FROM room_assignments WHERE assignment_date=(now() AT TIME ZONE 'Europe/Budapest')::date;
 EXCEPTION WHEN raise_exception THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Legacy XLS deleted the entire active assignment shift'; END IF;
 IF (SELECT count(*) FROM room_assignments) <> 3 THEN
   RAISE EXCEPTION 'Rollback did not preserve assignments'; END IF;
END $$;
ROLLBACK;
