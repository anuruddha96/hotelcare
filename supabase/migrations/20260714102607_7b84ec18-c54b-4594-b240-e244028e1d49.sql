ALTER TABLE public.pms_sync_history
  DROP CONSTRAINT IF EXISTS pms_sync_history_sync_type_check;

ALTER TABLE public.pms_sync_history
  ADD CONSTRAINT pms_sync_history_sync_type_check
  CHECK (sync_type = ANY (ARRAY[
    'rooms'::text,
    'reservations'::text,
    'status_update'::text,
    'minibar'::text,
    'room_kinds'::text,
    'rate_push'::text,
    'checkouts_poll'::text
  ]));