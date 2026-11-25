-- Regression for incident #294. Run against a disposable/temp fixture only.
-- This tests the same real trigger function as production, without touching
-- hotel rooms, assignments, guests, notifications or other live objects.
CREATE TEMP TABLE hc_manual_override_fixture (
  id integer PRIMARY KEY,
  is_checkout_room boolean NOT NULL,
  pms_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
) ON COMMIT DROP;
CREATE TRIGGER hc_fixture_manual_guard
BEFORE UPDATE OF is_checkout_room, pms_metadata ON hc_manual_override_fixture
FOR EACH ROW EXECUTE FUNCTION public.enforce_manual_room_type_override();
INSERT INTO hc_manual_override_fixture(id,is_checkout_room,pms_metadata)
VALUES (1,true,'{"pmsSyncDate":"2026-09-21"}'::jsonb);
DO $test$
DECLARE actual boolean; meta jsonb; stamp text;
BEGIN
  -- 1. The former bug: authenticated background flag-only PMS update must not
  -- create a sticky manual_daily marker.
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
  UPDATE hc_manual_override_fixture SET is_checkout_room=false WHERE id=1;
  SELECT is_checkout_room,pms_metadata INTO actual,meta FROM hc_manual_override_fixture WHERE id=1;
  IF actual OR meta ? 'manual_daily' OR meta ? 'manual_moved_at' THEN
    RAISE EXCEPTION 'Flag-only PMS update incorrectly generated a manual override';
  END IF;

  -- 2. A real explicit manager mark must take effect and stay sticky.
  stamp := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') || 'Z';
  UPDATE hc_manual_override_fixture
    SET is_checkout_room=true,
        pms_metadata=pms_metadata || jsonb_build_object(
          'manual_checkout',true,'manual_daily',false,'manual_moved_at',stamp)
    WHERE id=1;
  SELECT is_checkout_room,pms_metadata INTO actual,meta FROM hc_manual_override_fixture WHERE id=1;
  IF NOT actual OR meta->>'manual_checkout'<>'true' THEN
    RAISE EXCEPTION 'Explicit manual checkout was not accepted';
  END IF;
  UPDATE hc_manual_override_fixture SET is_checkout_room=false WHERE id=1;
  SELECT is_checkout_room INTO actual FROM hc_manual_override_fixture WHERE id=1;
  IF NOT actual THEN RAISE EXCEPTION 'PMS update overwrote an explicit manual checkout'; END IF;

  -- 3. A new explicitly stamped manual Daily change must also remain sticky.
  stamp := to_char((now()+interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') || 'Z';
  UPDATE hc_manual_override_fixture
    SET is_checkout_room=false,
        pms_metadata=pms_metadata || jsonb_build_object(
          'manual_checkout',false,'manual_daily',true,'manual_moved_at',stamp)
    WHERE id=1;
  SELECT is_checkout_room,pms_metadata INTO actual,meta FROM hc_manual_override_fixture WHERE id=1;
  IF actual OR meta->>'manual_daily'<>'true' THEN
    RAISE EXCEPTION 'Explicit manual daily switch was not accepted';
  END IF;
  UPDATE hc_manual_override_fixture SET is_checkout_room=true WHERE id=1;
  SELECT is_checkout_room INTO actual FROM hc_manual_override_fixture WHERE id=1;
  IF actual THEN RAISE EXCEPTION 'PMS update overwrote an explicit manual Daily'; END IF;
END $test$;
DROP TABLE hc_manual_override_fixture;
