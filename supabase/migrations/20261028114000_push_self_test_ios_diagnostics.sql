-- A user-initiated, rate-limited end-to-end push diagnostic for HotelCare.
-- Sends ONLY to the authenticated user's already registered devices.
-- No historic notifications, ticket changes or third-party recipients.
CREATE TABLE IF NOT EXISTS public.push_notification_self_tests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_notification_self_tests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_notification_self_tests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hotelcare_test_my_push()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _count integer;
  _sent_at timestamptz;
  _dispatch bigint;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notification_preferences p
    WHERE p.user_id = _uid AND p.browser_notifications_enabled IS TRUE
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'notifications_disabled');
  END IF;

  SELECT count(*) INTO _count
  FROM public.push_subscriptions ps
  WHERE ps.user_id = _uid;
  IF _count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_registered_device');
  END IF;

  -- The uniqueness constraint serializes simultaneous clicks. No more than
  -- one self-test push per user per 60 seconds, across all their devices.
  INSERT INTO public.push_notification_self_tests (user_id, last_sent_at)
  VALUES (_uid, clock_timestamp())
  ON CONFLICT (user_id) DO UPDATE
  SET last_sent_at = EXCLUDED.last_sent_at
  WHERE push_notification_self_tests.last_sent_at <= clock_timestamp() - interval '60 seconds'
  RETURNING last_sent_at INTO _sent_at;

  IF _sent_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  _dispatch := public.hotelcare_dispatch_push(
    ARRAY[_uid],
    'HotelCare test notification',
    'Your iPhone or browser is receiving live push alerts. No action needed.',
    '/',
    'hotelcare-user-push-test',
    'device_self_test',
    jsonb_build_object('test', true, 'requestedAt', clock_timestamp())
  );
  IF _dispatch IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'dispatch_unavailable');
  END IF;

  RETURN jsonb_build_object('ok', true, 'queued', true, 'registeredDevices', _count);
END;
$function$;

REVOKE ALL ON FUNCTION public.hotelcare_test_my_push() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hotelcare_test_my_push() TO authenticated;
