-- Reception Phase 1: Previo reservation fidelity + scheduled reservation sync.
--
-- Additive only. No existing column, function, trigger or policy is changed.
--   1. New nullable pms_* columns on public.reservations that hold what Previo
--      reports (status id, payment state, voucher, room-reservation id, channel).
--      They are written only by the previo-sync-reservations importer.
--   2. A Vault worker secret + two pg_cron jobs that call the new
--      previo-sync-reservations-all edge function.
--
-- Previo remains the reservation authority. Nothing here writes to Previo.

-- ------------------------------------------------------------
-- 1. Previo-reported fields
-- ------------------------------------------------------------
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS pms_reservation_id text,        -- Previo resId (shared by the rooms of a group booking)
  ADD COLUMN IF NOT EXISTS pms_room_reservation_id text,   -- Previo comId (one per booked room); needed for any future write-back
  ADD COLUMN IF NOT EXISTS pms_voucher text,               -- Previo voucher / OTA booking number
  ADD COLUMN IF NOT EXISTS pms_status_id smallint,         -- 1 option, 2 confirmed, 3 checked in, 6 waiting list, 7 cancelled, 8 no-show, 9 checked out, 10 other
  ADD COLUMN IF NOT EXISTS pms_payment_status text,        -- paid | unpaid | partial, as reported by Previo (cpsId)
  ADD COLUMN IF NOT EXISTS pms_channel text,               -- partner / sales channel name, e.g. "Booking.com"
  ADD COLUMN IF NOT EXISTS pms_channel_id text,            -- Previo partner id (prpId)
  ADD COLUMN IF NOT EXISTS pms_rate_plan_id text,          -- Previo rate plan id (prlId)
  ADD COLUMN IF NOT EXISTS pms_option_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS pms_locked boolean,             -- Previo "editationLocked"
  ADD COLUMN IF NOT EXISTS pms_group_note text,
  ADD COLUMN IF NOT EXISTS pms_contact_name text,
  ADD COLUMN IF NOT EXISTS pms_contact_email text,
  ADD COLUMN IF NOT EXISTS pms_contact_phone text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_pms_payment_status_chk'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_pms_payment_status_chk
      CHECK (pms_payment_status IS NULL OR pms_payment_status IN ('paid', 'unpaid', 'partial'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS reservations_pms_room_reservation_idx
  ON public.reservations (hotel_id, pms_room_reservation_id)
  WHERE pms_room_reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reservations_pms_voucher_idx
  ON public.reservations (hotel_id, pms_voucher)
  WHERE pms_voucher IS NOT NULL;

COMMENT ON COLUMN public.reservations.pms_payment_status IS
  'Payment state reported by Previo (cpsId). Informational: the HotelCare folio ledger is not changed by it.';
COMMENT ON COLUMN public.reservations.pms_room_reservation_id IS
  'Previo comId. Stable per booked room even when the room is moved in Previo.';

-- ------------------------------------------------------------
-- 2. Worker secret for the scheduled reservation sync
--    (same pattern as housekeeping_release_worker_secret)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'previo_reservation_sync_worker_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'previo_reservation_sync_worker_secret',
      'HotelCare scheduled Previo reservation sync cron secret',
      NULL
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_previo_reservation_sync_worker_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'previo_reservation_sync_worker_secret'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_previo_reservation_sync_worker_secret() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_previo_reservation_sync_worker_secret() FROM anon;
REVOKE ALL ON FUNCTION public.get_previo_reservation_sync_worker_secret() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_previo_reservation_sync_worker_secret() TO service_role;

-- ------------------------------------------------------------
-- 3. Schedules
--    * incremental: every 10 minutes, bookings changed in Previo in the last 2 days.
--      Minute offset 3 keeps it off the */5 and */15 Previo jobs (Previo rejects
--      simultaneous calls on one API key).
--    * horizon: hourly check; a hotel gets a full re-import only when its last
--      successful full import is older than 6 hours.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'previo-reservations-incremental-10min') THEN
      PERFORM cron.unschedule('previo-reservations-incremental-10min');
    END IF;
    PERFORM cron.schedule(
      'previo-reservations-incremental-10min',
      '3-59/10 * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/previo-sync-reservations-all',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', public.get_previo_reservation_sync_worker_secret()
          ),
          body := jsonb_build_object('mode', 'incremental', 'trigger', 'cron', 'scheduled_at', now()),
          timeout_milliseconds := 120000
        ) AS request_id;
      $cron$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'previo-reservations-horizon-hourly') THEN
      PERFORM cron.unschedule('previo-reservations-horizon-hourly');
    END IF;
    PERFORM cron.schedule(
      'previo-reservations-horizon-hourly',
      '38 * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/previo-sync-reservations-all',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', public.get_previo_reservation_sync_worker_secret()
          ),
          body := jsonb_build_object('mode', 'horizon', 'staleAfterHours', 6, 'trigger', 'cron', 'scheduled_at', now()),
          timeout_milliseconds := 150000
        ) AS request_id;
      $cron$
    );
  END IF;
END
$$;
