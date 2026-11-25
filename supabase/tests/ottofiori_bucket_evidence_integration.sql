BEGIN;
INSERT INTO public.rooms(hotel,room_number,is_checkout_room,pms_metadata)
VALUES ('Hotel Ottofiori','103',false,
 '{"pmsSyncDate":"2026-10-09","lastPmsRefreshDate":"2026-10-09","scheduledDepartureToday":false}'::jsonb);
UPDATE public.rooms SET pms_metadata = pms_metadata || '{"housekeepingNote":"new"}'
WHERE room_number='103';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.test_resolver_calls) <> 0
 THEN RAISE EXCEPTION 'Cosmetic metadata incorrectly triggered room reclassification'; END IF;
 IF (SELECT count(*) FROM public.pms_room_bucket_audit) <> 0
 THEN RAISE EXCEPTION 'Cosmetic metadata incorrectly created checkout audit row'; END IF;
END $$;

UPDATE public.rooms SET pms_metadata = pms_metadata || '{"checkedOutToday":true}'
WHERE room_number='103';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.test_resolver_calls) <> 1
 THEN RAISE EXCEPTION 'Verified physical departure change must run resolver'; END IF;
END $$;

UPDATE public.rooms SET is_checkout_room=true WHERE room_number='103';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.test_resolver_calls) <> 2
 THEN RAISE EXCEPTION 'Explicit room classification change must run resolver'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pms_room_bucket_audit
   WHERE room_number='103' AND old_checkout=false AND new_checkout=true)
 THEN RAISE EXCEPTION 'Checkout transition missing audit'; END IF;
END $$;

UPDATE public.rooms SET pms_metadata = pms_metadata || 
 '{"lastServerMorningSyncAt":"2026-10-09T04:20:00Z"}' WHERE room_number='103';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.test_resolver_calls) <> 3
 THEN RAISE EXCEPTION 'New full PMS evidence did not run resolver'; END IF;
 IF public.hc_ottofiori_bucket_evidence_changed(
   '{"pmsSyncDate":"2026-10-09"}'::jsonb,
   '{"pmsSyncDate":"2026-10-09","housekeepingNote":"new"}'::jsonb)
 THEN RAISE EXCEPTION 'Cosmetic metadata treated as reservation evidence'; END IF;
 IF NOT public.hc_ottofiori_bucket_evidence_changed(
   '{"checkedOutToday":false}'::jsonb,'{"checkedOutToday":true}'::jsonb)
 THEN RAISE EXCEPTION 'Physical departure evidence not detected'; END IF;
END $$;
ROLLBACK;
