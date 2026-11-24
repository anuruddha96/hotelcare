-- Four Phase-3 acceptance scenarios, executed in a disposable PostgreSQL
-- database with the *actual new migration* loaded before this file.
CREATE TRIGGER viza_on_reservation_status
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.viza_on_reservation_status();

INSERT INTO public.profiles(id,role,organization_slug)
VALUES('00000000-0000-4000-8000-000000000091','admin','test-org'),
      ('00000000-0000-4000-8000-000000000092','admin','late-org');

INSERT INTO public.hotel_access(user_id,hotel_id)
VALUES('00000000-0000-4000-8000-000000000091','test-hotel'),
      ('00000000-0000-4000-8000-000000000092','late-hotel');

INSERT INTO public.rooms(id,hotel,room_number,status,room_capacity)
VALUES('00000000-0000-4000-8000-000000000010','Test Property - HotelCare','101','clean',4),
      ('00000000-0000-4000-8000-000000000020','Late Test Property','201','clean',4);

INSERT INTO public.guests(id,first_name,last_name,hotel_id)
VALUES('00000000-0000-4000-8000-000000000031','Luca','Ferri','test-hotel'),
      ('00000000-0000-4000-8000-000000000032','No','ArrivalEvidence','late-hotel'),
      ('00000000-0000-4000-8000-000000000033','Viza','Evidence','late-hotel'),
      ('00000000-0000-4000-8000-000000000034','Late','Primary','late-hotel');

INSERT INTO public.ntak_settings(hotel_id,organization_slug,enabled,unit_scope)
VALUES('test-hotel','test-org',true,'all'),
      ('late-hotel','late-org',false,'all');
INSERT INTO public.viza_settings(hotel_id,organization_slug,enabled,adatszolgaltatasi_azonosito)
VALUES('test-hotel','test-org',true,'12345678'),
      ('late-hotel','late-org',true,'87654321');

INSERT INTO public.reservations(
  id,hotel_id,organization_slug,guest_id,room_id,status,
  check_in_date,check_out_date,adults,children,balance_due
) VALUES
  ('00000000-0000-4000-8000-000000000001','test-hotel','test-org',
   '00000000-0000-4000-8000-000000000031',
   '00000000-0000-4000-8000-000000000010','confirmed',
   (now() AT TIME ZONE 'Europe/Budapest')::date,
   (now() AT TIME ZONE 'Europe/Budapest')::date+2,1,0,0),
  ('00000000-0000-4000-8000-000000000002','test-hotel','test-org',
   NULL,'00000000-0000-4000-8000-000000000010','confirmed',
   (now() AT TIME ZONE 'Europe/Budapest')::date,
   (now() AT TIME ZONE 'Europe/Budapest')::date+2,1,0,0),
  ('00000000-0000-4000-8000-000000000003','late-hotel','late-org',
   '00000000-0000-4000-8000-000000000034',
   '00000000-0000-4000-8000-000000000020','checked_in',
   (now() AT TIME ZONE 'Europe/Budapest')::date,
   (now() AT TIME ZONE 'Europe/Budapest')::date+2,3,0,0),
  ('00000000-0000-4000-8000-000000000004','test-hotel','test-org',
   '00000000-0000-4000-8000-000000000031',
   '00000000-0000-4000-8000-000000000010','confirmed',
   (now() AT TIME ZONE 'Europe/Budapest')::date,
   (now() AT TIME ZONE 'Europe/Budapest')::date+2,1,0,0);

INSERT INTO public.reservation_guests(reservation_id,guest_id,is_primary)
VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',true),
      ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000034',true),
      ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000033',false),
      ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000032',false),
      ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000031',true);

INSERT INTO public.viza_guest_events
  (hotel_id,organization_slug,reservation_id,guest_id,
   erkezes_ideje,tavozas_varhato_datuma,arrival_state)
VALUES('late-hotel','late-org','00000000-0000-4000-8000-000000000003',
       '00000000-0000-4000-8000-000000000033',now(),
       (now() AT TIME ZONE 'Europe/Budapest')::date+2,'sent');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);

-- 1. Arrive -> undo -> arrive again: same guest, no duplicate guest row, exact
-- opposite NTAK event, original already-sent VIZA arrival flagged manual.
SELECT public.pms_guest_transition(
  '00000000-0000-4000-8000-000000000001','arrive',NULL,NULL,
  '00000000-0000-4000-8000-000000000010',false,false
);
UPDATE public.viza_guest_events SET arrival_state='sent'
  WHERE reservation_id='00000000-0000-4000-8000-000000000001';
SELECT public.pms_guest_transition(
  '00000000-0000-4000-8000-000000000001','undo_arrival',NULL,NULL,NULL,false,false
);
DO $$
BEGIN
  IF (SELECT stay_state FROM public.reservation_guests
      WHERE reservation_id='00000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'expected'
    OR (SELECT status::text FROM public.reservations
      WHERE id='00000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'confirmed'
    OR NOT EXISTS(SELECT 1 FROM public.ntak_event_queue
      WHERE reservation_id='00000000-0000-4000-8000-000000000001'
        AND kind='tavozott' AND is_correction
        AND guest_ids=ARRAY['00000000-0000-4000-8000-000000000031'::uuid])
    OR NOT EXISTS(SELECT 1 FROM public.viza_guest_events
      WHERE reservation_id='00000000-0000-4000-8000-000000000001'
        AND departure_state='queued' AND last_error ILIKE '%manual correction%')
  THEN RAISE EXCEPTION 'Acceptance 1: undo did not restore expected or flag corrections'; END IF;
END;
$$;
SELECT public.pms_guest_transition(
  '00000000-0000-4000-8000-000000000001','arrive',NULL,NULL,
  '00000000-0000-4000-8000-000000000010',false,false
);
DO $$
BEGIN
  IF (SELECT stay_state FROM public.reservation_guests
      WHERE reservation_id='00000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'in_house'
    OR (SELECT count(*) FROM public.ntak_event_queue
      WHERE reservation_id='00000000-0000-4000-8000-000000000001' AND kind='erkezett') <> 2
    OR NOT EXISTS(SELECT 1 FROM public.viza_guest_events
      WHERE reservation_id='00000000-0000-4000-8000-000000000001'
        AND last_error ILIKE '%manual correction%')
  THEN RAISE EXCEPTION 'Acceptance 1: guest could not re-arrive or VIZA manual flag lost'; END IF;
END;
$$;

-- 2. Enable NTAK AFTER check-in; retain a primary and a VIZA-confirmed
-- companion, leave unevidenced companion expected, and remain idempotent.
UPDATE public.ntak_settings SET enabled=true WHERE hotel_id='late-hotel';
DO $$
BEGIN
  IF (SELECT stay_state FROM public.reservation_guests
      WHERE reservation_id='00000000-0000-4000-8000-000000000003'
        AND guest_id='00000000-0000-4000-8000-000000000034') IS DISTINCT FROM 'in_house'
    OR (SELECT stay_state FROM public.reservation_guests
      WHERE reservation_id='00000000-0000-4000-8000-000000000003'
        AND guest_id='00000000-0000-4000-8000-000000000033') IS DISTINCT FROM 'in_house'
    OR (SELECT stay_state FROM public.reservation_guests
      WHERE reservation_id='00000000-0000-4000-8000-000000000003'
        AND guest_id='00000000-0000-4000-8000-000000000032') IS DISTINCT FROM 'expected'
    OR public.pms_rebuild_ntak_guest_states('late-hotel') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'Acceptance 2: activation did not preserve actual arrivals or was not idempotent';
  END IF;
END;
$$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',false);
SELECT public.pms_guest_transition(
  '00000000-0000-4000-8000-000000000003','depart',
  ARRAY['00000000-0000-4000-8000-000000000034'::uuid,
        '00000000-0000-4000-8000-000000000033'::uuid],NULL,NULL,false,false
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.reservation_guests
      WHERE reservation_id='00000000-0000-4000-8000-000000000003'
        AND stay_state='departed') IS DISTINCT FROM 2
  THEN RAISE EXCEPTION 'Acceptance 2: check-out of an existing arrival failed'; END IF;
END;
$$;

-- 3. No linked guest produces an actionable code (the UI mapping/translation
-- is checked independently in a Vitest test).
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',false);
DO $$
BEGIN
  BEGIN
    PERFORM public.pms_guest_transition(
      '00000000-0000-4000-8000-000000000002','arrive',NULL,NULL,
      '00000000-0000-4000-8000-000000000010',false,false
    );
    RAISE EXCEPTION 'No-guest check-in incorrectly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM IS DISTINCT FROM 'NO_ELIGIBLE_GUESTS' THEN RAISE; END IF;
  END;
END;
$$;

-- 4. Fault injection: VIZA queue INSERT raises; check-in STILL succeeds,
-- failure is visible in staff table/settings, and replay succeeds once fixed.
CREATE OR REPLACE FUNCTION public.ntak_test_reject_viza_queue()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'simulated VIZA queue outage';
END;
$$;
CREATE TRIGGER reject_viza_queue BEFORE INSERT ON public.viza_guest_events
FOR EACH ROW EXECUTE FUNCTION public.ntak_test_reject_viza_queue();

UPDATE public.reservations SET status='checked_in',actual_check_in=now()
  WHERE id='00000000-0000-4000-8000-000000000004';

DO $$
BEGIN
  IF (SELECT status::text FROM public.reservations
      WHERE id='00000000-0000-4000-8000-000000000004') IS DISTINCT FROM 'checked_in'
    OR NOT EXISTS(SELECT 1 FROM public.viza_trigger_failures
      WHERE reservation_id='00000000-0000-4000-8000-000000000004'
        AND resolved_at IS NULL AND last_error LIKE '%simulated VIZA%')
    OR NOT EXISTS(SELECT 1 FROM public.viza_settings
      WHERE hotel_id='test-hotel' AND last_error LIKE '%simulated VIZA%')
  THEN RAISE EXCEPTION 'Acceptance 4: VIZA failure blocked status or was not recorded'; END IF;
END;
$$;

DROP TRIGGER reject_viza_queue ON public.viza_guest_events;
SELECT public.pms_retry_viza_trigger_failure(id)
FROM public.viza_trigger_failures
WHERE reservation_id='00000000-0000-4000-8000-000000000004'
  AND resolved_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.viza_trigger_failures
      WHERE reservation_id='00000000-0000-4000-8000-000000000004'
        AND resolved_at IS NOT NULL)
    OR NOT EXISTS(SELECT 1 FROM public.viza_guest_events
      WHERE reservation_id='00000000-0000-4000-8000-000000000004'
        AND arrival_state='queued')
    OR EXISTS(SELECT 1 FROM public.viza_settings
      WHERE hotel_id='test-hotel' AND last_error LIKE 'VIZA queue error for reservation %')
  THEN RAISE EXCEPTION 'Acceptance 4: staff retry did not clear queue failure'; END IF;
END;
$$;

-- 5. Null legacy organization still logs a durable VIZA failure.
CREATE TRIGGER reject_viza_queue BEFORE INSERT ON public.viza_guest_events
FOR EACH ROW EXECUTE FUNCTION public.ntak_test_reject_viza_queue();
INSERT INTO public.reservations(id,hotel_id,organization_slug,guest_id,room_id,status,check_in_date,check_out_date,adults,children,balance_due)
VALUES('00000000-0000-4000-8000-000000000005','test-hotel',NULL,'00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000010','confirmed',current_date,current_date+2,1,0,0);
INSERT INTO public.reservation_guests(reservation_id,guest_id,is_primary) VALUES('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000031',true);
UPDATE public.reservations SET status='checked_in',actual_check_in=now() WHERE id='00000000-0000-4000-8000-000000000005';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.viza_trigger_failures WHERE reservation_id='00000000-0000-4000-8000-000000000005' AND organization_slug='test-org' AND resolved_at IS NULL) THEN RAISE EXCEPTION 'Null organization failure not durably recorded'; END IF;
END $$;
DROP TRIGGER reject_viza_queue ON public.viza_guest_events;
-- 6. A recorded departure must survive disable/re-enable even if the reservation remains checked in.
UPDATE public.ntak_settings SET enabled=false WHERE hotel_id='late-hotel';
UPDATE public.reservations SET status='checked_in' WHERE id='00000000-0000-4000-8000-000000000003';
UPDATE public.reservation_guests SET stay_state='expected',arrived_at=NULL,departed_at=NULL WHERE reservation_id='00000000-0000-4000-8000-000000000003' AND guest_id='00000000-0000-4000-8000-000000000033';
UPDATE public.viza_guest_events SET tavozas_ideje=now(),arrival_state='sent',departure_state='queued' WHERE reservation_id='00000000-0000-4000-8000-000000000003' AND guest_id='00000000-0000-4000-8000-000000000033';
UPDATE public.ntak_settings SET enabled=true WHERE hotel_id='late-hotel';
DO $$ BEGIN
 IF (SELECT stay_state FROM public.reservation_guests WHERE reservation_id='00000000-0000-4000-8000-000000000003' AND guest_id='00000000-0000-4000-8000-000000000033') <> 'expected' THEN RAISE EXCEPTION 'Activation resurrected an undone arrival'; END IF;
END $$;
