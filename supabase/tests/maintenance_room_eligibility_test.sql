\set ON_ERROR_STOP on

-- Server always persists the canonical PMS room name, not the browser's label.
INSERT INTO tickets(department,source,source_room_id,room_number,description,created_by,organization_slug,hotel,title)
VALUES ('maintenance','housekeeping','00000000-0000-0000-0000-000000000101','fake','Broken lamp',
 '00000000-0000-0000-0000-000000000001','rdhotels','gozsdu-court','Room fake: Broken lamp');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets WHERE source_room_id='00000000-0000-0000-0000-000000000101'
    AND room_number='1B-110' AND title='Room 1B-110: Broken lamp') THEN
    RAISE EXCEPTION 'Canonical PMS label was not persisted';
  END IF;
END $$;

CREATE FUNCTION public.assert_rejected(p_room uuid, p_hotel text, p_org text, p_code text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    INSERT INTO tickets(department,source,source_room_id,room_number,description,created_by,organization_slug,hotel,title)
    VALUES ('maintenance','manual',p_room,p_code,'Broken socket',
      '00000000-0000-0000-0000-000000000001',p_org,p_hotel,'Broken socket');
    RAISE EXCEPTION 'UNEXPECTED SUCCESS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'UNEXPECTED SUCCESS' THEN RAISE; END IF;
  END;
END $$;

-- Inactive, unmapped, cross-property, cross-tenant and out-of-order rooms fail.
SELECT assert_rejected('00000000-0000-0000-0000-000000000102','gozsdu-court','rdhotels','408');
SELECT assert_rejected('00000000-0000-0000-0000-000000000103','gozsdu-court','rdhotels','500');
SELECT assert_rejected('00000000-0000-0000-0000-000000000101','Hotel Memories Budapest','rdhotels','110');
SELECT assert_rejected('00000000-0000-0000-0000-000000000106','Other Hotel','rdhotels','101');
SELECT assert_rejected('00000000-0000-0000-0000-000000000105','Hotel Memories Budapest','rdhotels','202');

-- A cached legacy browser submitting room text should continue working when
-- the room resolves uniquely within that hotel; it gains a canonical UUID.
INSERT INTO tickets(department,source,source_room_id,room_number,description,created_by,organization_slug,hotel,title)
VALUES ('maintenance','manual',NULL,'110','Broken socket',
 '00000000-0000-0000-0000-000000000001','rdhotels','gozsdu-court','Broken socket');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets WHERE title='Broken socket'
    AND source_room_id='00000000-0000-0000-0000-000000000101' AND room_number='1B-110') THEN
    RAISE EXCEPTION 'Legacy room lookup did not resolve canonical UUID/name';
  END IF;
END $$;

-- An exact canonical Gozsdu PMS label is also accepted from an older client.
INSERT INTO tickets(department,source,source_room_id,room_number,description,created_by,organization_slug,hotel,title)
VALUES ('maintenance','manual',NULL,'1B-110','Broken bed',
 '00000000-0000-0000-0000-000000000001','rdhotels','Gozsdu Court Budapest','Broken bed');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets WHERE title='Broken bed'
    AND source_room_id='00000000-0000-0000-0000-000000000101' AND room_number='1B-110') THEN
    RAISE EXCEPTION 'Legacy full PMS name was not resolved';
  END IF;
END $$;

-- Unknown legacy room, mismatched hotel, inactive room, and missing location fail.
SELECT assert_rejected(NULL,'gozsdu-court','rdhotels','forged-room');
SELECT assert_rejected(NULL,'Hotel Memories Budapest','rdhotels','110');
SELECT assert_rejected(NULL,'gozsdu-court','rdhotels','408');
SELECT assert_rejected(NULL,'Gozsdu Court Budapest','rdhotels','N/A');

-- Non-Gozsdu occupied/dirty inventory remains eligible.
INSERT INTO tickets(department,source,source_room_id,room_number,description,created_by,organization_slug,hotel,title)
VALUES ('maintenance','manual','00000000-0000-0000-0000-000000000104','forged','Broken lamp',
 '00000000-0000-0000-0000-000000000001','rdhotels','Hotel Memories Budapest','Broken lamp');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets WHERE source_room_id='00000000-0000-0000-0000-000000000104' AND room_number='201') THEN
    RAISE EXCEPTION 'Non-Gozsdu canonical room code missing';
  END IF;
END $$;

INSERT INTO tickets(department,source,source_room_id,room_number,description,created_by,organization_slug,hotel,title)
VALUES ('maintenance','manual',NULL,'N/A',E'Location: Reception\nBroken door',
 '00000000-0000-0000-0000-000000000001','rdhotels','Gozsdu Court Budapest','Broken door');

-- Existing tickets stay writable after the room has become inactive.
UPDATE tickets SET status='completed' WHERE source_room_id='00000000-0000-0000-0000-000000000101';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets WHERE source_room_id='00000000-0000-0000-0000-000000000101' AND status='completed') THEN
    RAISE EXCEPTION 'Historical ticket update unexpectedly failed';
  END IF;
END $$;

-- Non-maintenance departments remain outside this guard.
INSERT INTO tickets(department,source,source_room_id,room_number,description,created_by,organization_slug,hotel,title)
VALUES ('reception','manual',NULL,'N/A','Reception note',
 '00000000-0000-0000-0000-000000000001','rdhotels','Gozsdu Court Budapest','Reception note');
SELECT 'maintenance room eligibility SQL tests passed' AS result;
