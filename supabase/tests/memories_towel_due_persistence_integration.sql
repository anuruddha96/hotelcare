-- Isolated CI fixture: run AFTER existing Memories service-cycle integrations.
-- The setup fixture and schema belong to a disposable Postgres instance only.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.rooms(
  hotel,organization_slug,room_number,status,guest_nights_stayed,
  towel_change_required,linen_change_required,pms_metadata
) VALUES (
  'Hotel Memories Budapest','rdhotels','205-regression','clean',2,false,false,
  jsonb_build_object(
    'pmsSyncDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
    'lastPmsRefreshDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
    'currentNight',2,'totalNights',3,'occupiedToday',true,
    'stayThroughToday',true,'notArrived',false,'reservationId','205-test',
    'arrivalDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date-2)::text,
    'departureDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date+1)::text)
);
INSERT INTO public.housekeeping_room_snapshots(business_date,room_id,hotel,organization_slug)
SELECT (statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date,id,hotel,organization_slug
FROM public.rooms WHERE room_number='205-regression';

-- Reproduce live contradiction: 3/3 occupied, but Previo also says notArrived.
UPDATE public.rooms
SET pms_metadata=pms_metadata || jsonb_build_object(
  'pmsSyncDate',(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date::text,
  'lastPmsRefreshDate',(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date::text,
  'currentNight',3,'totalNights',3,
  'notArrived',true,'arrivalToday',true,
  'arrivalDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date-2)::text)
WHERE room_number='205-regression';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rooms WHERE room_number='205-regression'
    AND towel_change_required AND NOT linen_change_required
  ) THEN RAISE EXCEPTION '3/3 occupied continuing stay lost towel duty because of stale notArrived'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.housekeeping_room_snapshots s
    JOIN public.rooms r ON r.id=s.room_id
    WHERE r.room_number='205-regression'
      AND s.scheduled_service_due->>'towel'='true'
      AND s.scheduled_service_due->>'stay_night'='3'
  ) THEN RAISE EXCEPTION 'Scheduled T was not persisted in the dated audit'; END IF;
END $$;

-- A later refresh must not remove the same-day T or its first-seen timestamp.
UPDATE public.rooms
SET pms_metadata=pms_metadata || '{"noteOta":"new Pms note"}'::jsonb
WHERE room_number='205-regression';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rooms WHERE room_number='205-regression'
    AND towel_change_required AND NOT linen_change_required
  ) THEN RAISE EXCEPTION 'Repeated PMS sync removed 3/3 towel duty'; END IF;
END $$;

-- Transient PMS flags can legitimately turn a stay into a no-show. Live T
-- must disappear, while the dated proof stays for read-only historical audit.
UPDATE public.rooms
SET pms_metadata=pms_metadata || '{"isNoShow":true}'::jsonb
WHERE room_number='205-regression';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.rooms WHERE room_number='205-regression'
    AND (towel_change_required OR linen_change_required)
  ) THEN RAISE EXCEPTION 'No-show erroneously kept an active stayover duty'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.housekeeping_room_snapshots s
    JOIN public.rooms r ON r.id=s.room_id
    WHERE r.room_number='205-regression'
      AND s.scheduled_service_due->>'towel'='true'
  ) THEN RAISE EXCEPTION 'Later no-show update erased previously scheduled T audit'; END IF;
END $$;

-- An actual not-arrived first night is not a stayover.
INSERT INTO public.rooms(
  hotel,organization_slug,room_number,status,guest_nights_stayed,
  towel_change_required,linen_change_required,pms_metadata
) VALUES (
  'Hotel Memories Budapest','rdhotels','205-false-occupancy','clean',3,false,false,
  jsonb_build_object(
    'pmsSyncDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
    'lastPmsRefreshDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date-1)::text,
    'currentNight',3,'totalNights',3,'occupiedToday',false,'stayThroughToday',false,
    'notArrived',true,'reservationId','false-occupancy',
    'arrivalDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date-2)::text,
    'departureDate',((statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date+1)::text)
);
UPDATE public.rooms
SET pms_metadata=pms_metadata || jsonb_build_object(
  'pmsSyncDate',(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date::text,
  'lastPmsRefreshDate',(statement_timestamp() AT TIME ZONE 'Europe/Budapest')::date::text)
WHERE room_number='205-false-occupancy';

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.rooms WHERE room_number='205-false-occupancy'
    AND (towel_change_required OR linen_change_required)
  ) THEN RAISE EXCEPTION 'Unoccupied notArrived room was given stayover T'; END IF;
END $$;

-- Another venue is deliberately unchanged.
INSERT INTO public.rooms(
  hotel,organization_slug,room_number,status,guest_nights_stayed,
  towel_change_required,linen_change_required,pms_metadata
) VALUES ('Hotel Mika Downtown','rdhotels','other-205','clean',3,true,false,'{}');
UPDATE public.rooms SET pms_metadata='{"notArrived":true,"occupiedToday":true}'::jsonb
WHERE room_number='other-205';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rooms WHERE room_number='other-205'
    AND towel_change_required AND NOT linen_change_required
  ) THEN RAISE EXCEPTION 'HMB fix unexpectedly modified non-HMB service flags'; END IF;
END $$;

ROLLBACK;
