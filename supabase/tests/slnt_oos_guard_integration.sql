\set ON_ERROR_STOP on

INSERT INTO public.rooms (id, organization_slug, status, pms_metadata)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'slnt', 'out_of_order',
   '{"slntManualOutOfService":true,"slntManualOutOfServiceAt":"2026-09-24T07:00:00Z"}'::jsonb),
  ('00000000-0000-0000-0000-000000000002', 'rdhotels', 'out_of_order', '{}'::jsonb);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.room_assignments (id, room_id, assigned_to)
    VALUES (
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'expected SLNT OOS assignment to be rejected';
  EXCEPTION
    WHEN check_violation THEN
      IF position('SLNT_ROOM_OUT_OF_SERVICE' in SQLERRM) = 0 THEN
        RAISE;
      END IF;
  END;
END;
$$;

-- Simulate a PMS refresh that tries to clear the room status and replaces
-- metadata without the manual flag. The manager block must win.
UPDATE public.rooms
SET status = 'dirty',
    pms_metadata = '{"pmsRefresh":"2026-09-24T07:30:00Z"}'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000001';

DO $$
DECLARE
  v_status text;
  v_manual boolean;
BEGIN
  SELECT status, coalesce((pms_metadata->>'slntManualOutOfService')::boolean, false)
  INTO v_status, v_manual
  FROM public.rooms
  WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_status <> 'out_of_order' OR NOT v_manual THEN
    RAISE EXCEPTION 'PMS refresh incorrectly cleared SLNT OOS block';
  END IF;
END;
$$;

-- Explicit manager release is the only path that clears the persisted block.
UPDATE public.rooms
SET status = 'dirty',
    pms_metadata = pms_metadata || '{"slntManualOutOfService":false}'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO public.room_assignments (id, room_id, assigned_to)
VALUES (
  '10000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001'
);

-- The feature is tenant-scoped: another organization's OOS status is not
-- changed by this SLNT-specific guard.
INSERT INTO public.room_assignments (id, room_id, assigned_to)
VALUES (
  '10000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000002'
);

DO $$
BEGIN
  IF (SELECT count(*) FROM public.room_assignments) <> 2 THEN
    RAISE EXCEPTION 'unexpected assignment count after OOS guard tests';
  END IF;
END;
$$;
