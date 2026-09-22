-- Read-only regression cases for the Ottofiori-specific migration, issue #325.
-- Run after the migration against a test DB; raises an error on any regression.
DO $tests$
DECLARE
  actual text;
BEGIN
  -- Prior no-show, stale departure, different reservation arriving today.
  SELECT public.hc_ottofiori_checkout_decision(true,false,true,true,true,true,false,false,false,false) INTO actual;
  IF actual <> 'daily' THEN RAISE EXCEPTION 'no-show mistakenly treated as checkout: %', actual; END IF;

  -- Room 101: yesterday's no-show has disappeared from today's snapshot.
  SELECT public.hc_ottofiori_checkout_decision(false,false,true,true,false,true,false,false,false,false) INTO actual;
  IF actual <> 'daily' THEN RAISE EXCEPTION 'room 101 arrival wrong: %', actual; END IF;

  -- Real occupied departure remains checkout.
  SELECT public.hc_ottofiori_checkout_decision(true,false,false,true,false,false,true,false,false,false) INTO actual;
  IF actual <> 'checkout' THEN RAISE EXCEPTION 'real departure lost: %', actual; END IF;

  -- Confirmed real checkout needs cleaning even when a new guest is due.
  SELECT public.hc_ottofiori_checkout_decision(false,true,true,true,false,true,false,true,false,false) INTO actual;
  IF actual <> 'checkout' THEN RAISE EXCEPTION 'turnover checkout lost: %', actual; END IF;

  -- Not arrived is not automatically a no-show, but must never be a checkout.
  SELECT public.hc_ottofiori_checkout_decision(false,false,false,true,false,true,false,false,false,false) INTO actual;
  IF actual <> 'daily' THEN RAISE EXCEPTION 'late arrival classified as checkout: %', actual; END IF;

  -- A stale/empty PMS snapshot alone must not create a new checkout.
  SELECT public.hc_ottofiori_checkout_decision(false,false,false,false,false,false,false,false,false,false) INTO actual;
  IF actual <> 'keep' THEN RAISE EXCEPTION 'missing PMS data invented departure: %', actual; END IF;

  -- Today's explicit manager choices take precedence.
  SELECT public.hc_ottofiori_checkout_decision(true,false,false,true,false,false,true,false,true,false) INTO actual;
  IF actual <> 'daily' THEN RAISE EXCEPTION 'manager daily override lost: %', actual; END IF;
  SELECT public.hc_ottofiori_checkout_decision(false,false,true,true,false,true,false,false,false,true) INTO actual;
  IF actual <> 'checkout' THEN RAISE EXCEPTION 'manager checkout override lost: %', actual; END IF;

  -- Production invariant for room 101; no write and no personal guest data.
  IF EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.hotel='Hotel Ottofiori' AND r.room_number='101'
      AND r.pms_metadata->>'arrivalToday'='true'
      AND r.pms_metadata->>'notArrived'='true'
      AND r.pms_metadata->>'checkedOutToday' IS DISTINCT FROM 'true'
      AND (r.is_checkout_room IS TRUE
           OR r.pms_metadata->>'scheduledDepartureToday'='true')
  ) THEN RAISE EXCEPTION 'Ottofiori 101 has regressed into checkout'; END IF;
  RAISE NOTICE 'PASS: 8 regression cases plus live room 101 invariant';
END;
$tests$;
