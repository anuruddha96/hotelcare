-- VIZA: send at check-in, problem tracking and the 1-hour alert to HotelCare support.
--
-- Guide v700 §6.2 expects the data to be sent at the moment of check-in, and §4
-- asks that the operator is notified when the THF reports WARNING or ERROR. The
-- 10-minute worker stays as the safety net; reception now also asks for an
-- immediate send. A short per-hotel lease stops the two from sending the same
-- guests at the same time. No existing data is changed.

ALTER TABLE public.viza_settings
  ADD COLUMN IF NOT EXISTS problem_since timestamptz,
  ADD COLUMN IF NOT EXISTS problem_kind text,
  ADD COLUMN IF NOT EXISTS problem_alert_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_lock_until timestamptz;

COMMENT ON COLUMN public.viza_settings.problem_since IS
  'When the current VIZA problem started (THF unreachable, THF WARNING/ERROR, no certificate); null while everything works.';
COMMENT ON COLUMN public.viza_settings.problem_kind IS
  'unreachable | thf_warning | thf_error | no_certificate';
COMMENT ON COLUMN public.viza_settings.problem_alert_sent_at IS
  'When HotelCare support (info@hotelcare.app) was told about the current problem; cleared when it is resolved.';
COMMENT ON COLUMN public.viza_settings.send_lock_until IS
  'Short lease held while one sender (worker or instant send) is talking to the THF for this hotel.';

ALTER TABLE public.viza_settings
  DROP CONSTRAINT IF EXISTS viza_settings_problem_kind_check;
ALTER TABLE public.viza_settings
  ADD CONSTRAINT viza_settings_problem_kind_check
  CHECK (problem_kind IS NULL OR problem_kind IN ('unreachable', 'thf_warning', 'thf_error', 'no_certificate'));

ALTER TABLE public.viza_guest_events
  ADD COLUMN IF NOT EXISTS correction_alert_sent_at timestamptz;

COMMENT ON COLUMN public.viza_guest_events.correction_alert_sent_at IS
  'When HotelCare support was told that this rejected guest report was not corrected within an hour; cleared when it is sent again.';

-- Take the hotel's send lease. Returns true only for the caller that got it.
CREATE OR REPLACE FUNCTION public.viza_try_send_lock(_hotel_id text, _seconds integer DEFAULT 90)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  taken integer;
BEGIN
  UPDATE public.viza_settings
     SET send_lock_until = now() + make_interval(secs => greatest(10, least(coalesce(_seconds, 90), 300)))
   WHERE hotel_id = _hotel_id
     AND (send_lock_until IS NULL OR send_lock_until < now());
  GET DIAGNOSTICS taken = ROW_COUNT;
  RETURN taken > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.viza_release_send_lock(_hotel_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.viza_settings SET send_lock_until = NULL WHERE hotel_id = _hotel_id;
$$;

REVOKE ALL ON FUNCTION public.viza_try_send_lock(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.viza_release_send_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.viza_try_send_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.viza_release_send_lock(text) TO service_role;
