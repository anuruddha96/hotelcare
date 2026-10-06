-- `runPmsRefresh()` and the SLNT server-side morning sync both record a
-- `rooms_refresh` audit event. The original check constraint predates that
-- sync type, so those otherwise successful audit inserts were rejected.
-- Keep every existing allowed value and add only the missing room-refresh type.

alter table public.pms_sync_history
  drop constraint if exists pms_sync_history_sync_type_check;

alter table public.pms_sync_history
  add constraint pms_sync_history_sync_type_check
  check (
    sync_type = any (
      array[
        'rooms'::text,
        'rooms_refresh'::text,
        'reservations'::text,
        'status_update'::text,
        'minibar'::text,
        'room_kinds'::text,
        'rate_push'::text,
        'checkouts_poll'::text,
        'revenue_sync'::text,
        'revenue_live'::text,
        'daily_overview_live'::text
      ]
    )
  );
