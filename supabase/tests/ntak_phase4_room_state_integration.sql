-- Phase 4 real-Postgres acceptance: audited room history, no-overlap, RLS,
-- today status synchronization, early end and tenant isolation.
-- Follows ntak_fixture + ntak_phase4_fixture + actual Phase 4 migration.
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',false);
SET ROLE authenticated;

-- NZ_02 T02: room 103 OOO, room 104 OOS. Display name != hotel_id.
SELECT public.pms_add_room_state_period('channex-test-property',
  '00000000-0000-4000-8000-000000000103',
  'out_of_order','2026-11-18','2026-11-18','NZ_02 room 103 test');
SELECT public.pms_add_room_state_period('channex-test-property',
  '00000000-0000-4000-8000-000000000104',
  'out_of_service','2026-11-18','2026-11-18','NZ_02 room 104 test');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.room_state_periods WHERE hotel_id='channex-test-property'
      AND from_date='2026-11-18' AND to_date='2026-11-18') <> 2
    OR NOT EXISTS(SELECT 1 FROM public.room_state_periods
      WHERE room_id='00000000-0000-4000-8000-000000000103'
      AND state='out_of_order')
    OR NOT EXISTS(SELECT 1 FROM public.room_state_periods
      WHERE room_id='00000000-0000-4000-8000-000000000104'
      AND state='out_of_service')
  THEN RAISE EXCEPTION 'NZ_02 historical periods absent'; END IF;
END $$;
DO $$
BEGIN
  BEGIN
    PERFORM public.pms_add_room_state_period('channex-test-property',
      '00000000-0000-4000-8000-000000000103',
      'out_of_service','2026-11-18','2026-11-19','must conflict');
    RAISE EXCEPTION 'Overlapping room periods were accepted';
  EXCEPTION WHEN exclusion_violation THEN NULL;
  END;
END $$;

-- A prior-day start, extending beyond today: today's live room status is
-- immediately synchronized to OOO. Other status writes cannot override it.
SELECT public.pms_add_room_state_period('channex-test-property',
  '00000000-0000-4000-8000-000000000102',
  'out_of_order',
  (now() AT TIME ZONE 'Europe/Budapest')::date - 1,
  (now() AT TIME ZONE 'Europe/Budapest')::date + 2,
  'Plumbing repair until resolved');
DO $$
BEGIN
  IF (SELECT status FROM public.rooms
      WHERE id='00000000-0000-4000-8000-000000000102') <> 'out_of_order'
    OR (SELECT original_status FROM public.room_state_status_baselines
      WHERE room_id='00000000-0000-4000-8000-000000000102') <> 'dirty'
  THEN RAISE EXCEPTION 'Active room period did not synchronize or preserve status'; END IF;
END $$;
UPDATE public.rooms SET status='clean'
  WHERE id='00000000-0000-4000-8000-000000000102';
DO $$
BEGIN
  IF (SELECT status FROM public.rooms
      WHERE id='00000000-0000-4000-8000-000000000102') <> 'out_of_order'
  THEN RAISE EXCEPTION 'Manual housekeeping update overrode active room period'; END IF;
END $$;

-- End on yesterday, preserve historical day and release today.
SELECT public.pms_end_room_state_period(p.id,
  (now() AT TIME ZONE 'Europe/Budapest')::date - 1)
FROM public.room_state_periods p
WHERE p.room_id='00000000-0000-4000-8000-000000000102';
DO $$
BEGIN
  IF (SELECT status FROM public.rooms
      WHERE id='00000000-0000-4000-8000-000000000102') <> 'dirty'
    OR EXISTS(SELECT 1 FROM public.room_state_status_baselines
      WHERE room_id='00000000-0000-4000-8000-000000000102')
  THEN RAISE EXCEPTION 'Ending period did not restore housekeeping state'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.room_state_periods
    WHERE room_id='00000000-0000-4000-8000-000000000102'
      AND to_date=(now() AT TIME ZONE 'Europe/Budapest')::date - 1)
  THEN RAISE EXCEPTION 'Ending period destroyed its history'; END IF;
END $$;

-- Future period must NOT change today's housekeeping status.
SELECT public.pms_add_room_state_period('channex-test-property',
  '00000000-0000-4000-8000-000000000101',
  'out_of_service',
  (now() AT TIME ZONE 'Europe/Budapest')::date + 1,
  (now() AT TIME ZONE 'Europe/Budapest')::date + 3,
  'Future roof repair');
DO $$
BEGIN
  IF (SELECT status FROM public.rooms
      WHERE id='00000000-0000-4000-8000-000000000101') <> 'clean'
  THEN RAISE EXCEPTION 'Future period wrongly changed the room today'; END IF;
END $$;

-- Different-hotel/organization room IDs must never be accepted.
DO $$
BEGIN
  BEGIN
    PERFORM public.pms_add_room_state_period('channex-test-property',
      '00000000-0000-4000-8000-000000000105',
      'out_of_order','2026-11-18','2026-11-18','wrong hotel');
    RAISE EXCEPTION 'Cross-hotel room state write succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ROOM_WRONG_HOTEL' THEN RAISE; END IF;
  END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000072',false);
SET ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.room_state_periods
    WHERE hotel_id='channex-test-property') <> 4
  THEN RAISE EXCEPTION 'Housekeeper cannot view own room periods'; END IF;
  BEGIN
    PERFORM public.pms_add_room_state_period('channex-test-property',
      '00000000-0000-4000-8000-000000000101',
      'out_of_order','2026-11-13','2026-11-13','unauthorized');
    RAISE EXCEPTION 'Housekeeper was allowed to mutate manager-only periods';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'ACCESS_DENIED' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000073',false);
SET ROLE authenticated;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.room_state_periods
    WHERE hotel_id='channex-test-property') THEN
    RAISE EXCEPTION 'Cross-organization history leaked';
  END IF;
END $$;
RESET ROLE;
