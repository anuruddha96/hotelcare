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
        'daily_overview_live'::text,
        'availability_push'::text,
        'restriction_push'::text
      ]
    )
  );
