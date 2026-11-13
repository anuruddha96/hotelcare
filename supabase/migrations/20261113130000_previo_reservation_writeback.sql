-- Reception Phase 2, first slice: send check-in / check-out done in HotelCare to Previo.
--
-- Safe by default:
--   * Per-hotel switch pms_configurations.reservation_writeback_mode: 'off' (default) | 'dry_run' | 'live'.
--     'dry_run' records exactly what would be sent and sends nothing.
--   * The existing pms_configurations.outbound_kill_switch stops every live send.
--   * Only HotelCare's own lifecycle actions are sent: the trigger fires when
--     actual_check_in / actual_check_out are first set, which only
--     pms_check_in_reservation / pms_check_out_reservation do. Changes imported
--     from Previo never set them, so nothing echoes back to Previo.
--   * Cancellations and no-shows are deliberately not sent in this slice.

ALTER TABLE public.pms_configurations
  ADD COLUMN IF NOT EXISTS reservation_writeback_mode text NOT NULL DEFAULT 'off';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pms_configurations_reservation_writeback_mode_chk') THEN
    ALTER TABLE public.pms_configurations
      ADD CONSTRAINT pms_configurations_reservation_writeback_mode_chk
      CHECK (reservation_writeback_mode IN ('off', 'dry_run', 'live'));
  END IF;
END
$$;

COMMENT ON COLUMN public.pms_configurations.reservation_writeback_mode IS
  'Send HotelCare check-in/check-out to Previo: off (default), dry_run (record only), live. outbound_kill_switch overrides live.';

CREATE TABLE IF NOT EXISTS public.pms_reservation_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id text NOT NULL,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('check_in', 'check_out')),
  mode text NOT NULL CHECK (mode IN ('dry_run', 'live')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'dry_run', 'failed', 'blocked')),
  pms_reservation_id text,
  pms_room_reservation_id text,
  room_changed boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request jsonb,
  last_error text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (reservation_id, action)
);

CREATE INDEX IF NOT EXISTS pms_reservation_outbox_due_idx
  ON public.pms_reservation_outbox (next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE public.pms_reservation_outbox ENABLE ROW LEVEL SECURITY;

-- Staff see the write-back state of bookings they can already see (the
-- reservations RLS applies inside the subquery). Only the trigger and the
-- service-role worker write.
DROP POLICY IF EXISTS "Read write-back state of visible reservations" ON public.pms_reservation_outbox;
CREATE POLICY "Read write-back state of visible reservations"
  ON public.pms_reservation_outbox FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = pms_reservation_outbox.reservation_id));

CREATE OR REPLACE FUNCTION public.pms_enqueue_reservation_writeback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  IF NEW.source IS DISTINCT FROM 'previo' THEN
    RETURN NEW;
  END IF;

  SELECT c.reservation_writeback_mode INTO v_mode
  FROM public.pms_configurations c
  WHERE c.hotel_id = NEW.hotel_id AND c.pms_type = 'previo' AND c.is_active = true
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_mode IS NULL OR v_mode = 'off' THEN
    RETURN NEW;
  END IF;

  IF OLD.actual_check_in IS NULL AND NEW.actual_check_in IS NOT NULL THEN
    INSERT INTO public.pms_reservation_outbox
      (hotel_id, reservation_id, action, mode, pms_reservation_id, pms_room_reservation_id, room_changed)
    VALUES
      (NEW.hotel_id, NEW.id, 'check_in', v_mode, NEW.pms_reservation_id, NEW.pms_room_reservation_id,
       OLD.room_id IS DISTINCT FROM NEW.room_id)
    ON CONFLICT (reservation_id, action) DO NOTHING;
  END IF;

  IF OLD.actual_check_out IS NULL AND NEW.actual_check_out IS NOT NULL THEN
    INSERT INTO public.pms_reservation_outbox
      (hotel_id, reservation_id, action, mode, pms_reservation_id, pms_room_reservation_id, room_changed)
    VALUES
      (NEW.hotel_id, NEW.id, 'check_out', v_mode, NEW.pms_reservation_id, NEW.pms_room_reservation_id, false)
    ON CONFLICT (reservation_id, action) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pms_enqueue_reservation_writeback() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_reservations_enqueue_previo_writeback ON public.reservations;
CREATE TRIGGER tr_reservations_enqueue_previo_writeback
  AFTER UPDATE OF actual_check_in, actual_check_out ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.pms_enqueue_reservation_writeback();

-- Worker schedule: every 2 minutes (odd minutes, away from the */5 and */10 Previo jobs).
-- Cheap when idle: it reads due outbox rows and returns.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'previo-reservation-writeback-2min') THEN
      PERFORM cron.unschedule('previo-reservation-writeback-2min');
    END IF;
    PERFORM cron.schedule(
      'previo-reservation-writeback-2min',
      '1-59/2 * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/previo-reservation-writeback',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-worker-secret', public.get_previo_reservation_sync_worker_secret()
          ),
          body := jsonb_build_object('trigger', 'cron', 'scheduled_at', now()),
          timeout_milliseconds := 60000
        ) AS request_id
        WHERE EXISTS (SELECT 1 FROM public.pms_reservation_outbox WHERE status = 'pending' AND next_attempt_at <= now());
      $cron$
    );
  END IF;
END
$$;
