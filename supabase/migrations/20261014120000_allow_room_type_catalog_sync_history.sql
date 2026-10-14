-- The 2026-10-14 Previo "Refresh room types" action records a catalog-only
-- audit event using sync_type='room_type_catalog'. The older CHECK constraint
-- accepted 'room_kinds' but rejected the new explicit catalog event *after*
-- the PMS room_types upserts had already completed, incorrectly reporting a
-- user-visible refresh failure. Add the new type without changing existing
-- rows, pricing, availability, or previously accepted sync categories.
--
-- Safe to rerun: dropping and recreating the same validated constraint does
-- not modify PMS business data.

ALTER TABLE public.pms_sync_history
  DROP CONSTRAINT IF EXISTS pms_sync_history_sync_type_check;

ALTER TABLE public.pms_sync_history
  ADD CONSTRAINT pms_sync_history_sync_type_check
  CHECK (sync_type = ANY (ARRAY[
    'rooms'::text,
    'rooms_refresh'::text,
    'reservations'::text,
    'status_update'::text,
    'minibar'::text,
    'room_kinds'::text,
    'room_type_catalog'::text,
    'rate_push'::text,
    'checkouts_poll'::text,
    'revenue_sync'::text,
    'revenue_live'::text,
    'daily_overview_live'::text,
    'availability_push'::text,
    'restriction_push'::text
  ]));
