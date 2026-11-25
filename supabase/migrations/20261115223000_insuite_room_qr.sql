-- In-Suite per-room guest QR access: a room may now have BOTH one active
-- tablet and one active QR code. QR devices are pre-paired (token in the QR),
-- guest actions still require a verified checked-in stay.
ALTER TABLE public.insuite_devices
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'tablet'
  CHECK (kind IN ('tablet','qr'));

DROP INDEX IF EXISTS public.insuite_one_active_device_per_room;
CREATE UNIQUE INDEX IF NOT EXISTS insuite_one_active_device_per_room_kind
  ON public.insuite_devices(room_id, kind) WHERE is_active = true;
