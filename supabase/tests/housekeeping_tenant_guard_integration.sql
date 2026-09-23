-- Exercised only in GitHub Actions against disposable Postgres, not Supabase.
-- This fixture tests SQL syntax, RLS denials and preservation of old mislinked
-- work. Production schema, existing permissions and data still require review.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.room_assignments) <> 2 THEN
    RAISE EXCEPTION 'Migration changed or deleted historical assignment rows';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
    AND indexname='next_day_hk_one_primary_per_room_idx') THEN
    RAISE EXCEPTION 'Primary assignment uniqueness index was not created';
  END IF;
END $$;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000011'; -- RD / Mika manager
DO $$
DECLARE denied boolean;
BEGIN
  IF (SELECT count(*) FROM public.assignment_patterns) <> 1 THEN
    RAISE EXCEPTION 'Mika manager can see another hotel/organization pattern';
  END IF;
  -- Old permissive INSERT policy must be removed, not left OR-ed with the new one.
  denied := false;
  BEGIN
    INSERT INTO public.assignment_patterns(organization_slug,hotel)
      VALUES ('slnt','slnt-one');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-organization pattern insert succeeded'; END IF;
  denied := false;
  BEGIN
    INSERT INTO public.assignment_patterns(organization_slug,hotel)
      VALUES ('rdhotels','memories');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Cross-property pattern insert succeeded'; END IF;

  -- Legitimate hotel data remains writable.
  INSERT INTO public.assignment_patterns(organization_slug,hotel)
    VALUES ('rdhotels','mika');

  -- Attempt a foreign staff member in a same-org plan.
  denied := false;
  BEGIN
    INSERT INTO public.next_day_housekeeping_plan_staff(plan_id,user_id)
      VALUES ('00000000-0000-4000-8000-000000000031',
              '00000000-0000-4000-8000-000000000015');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Foreign staff inserted into RD plan'; END IF;

  -- An old soft-deleted employee may have their obsolete staff row removed,
  -- but an attempted reassignment to a foreign organization must be denied.
  denied := false;
  BEGIN
    UPDATE public.next_day_housekeeping_plan_staff
    SET user_id='00000000-0000-4000-8000-000000000015'
    WHERE user_id='00000000-0000-4000-8000-000000000017';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Foreign replacement staff allowed'; END IF;
  DELETE FROM public.next_day_housekeeping_plan_staff
    WHERE user_id='00000000-0000-4000-8000-000000000017';

  -- A plan item may not be reassigned to another tenant's worker or room.
  denied := false;
  BEGIN
    UPDATE public.next_day_housekeeping_plan_items
    SET assigned_to='00000000-0000-4000-8000-000000000015';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Foreign next-day assignee allowed'; END IF;
  denied := false;
  BEGIN
    UPDATE public.next_day_housekeeping_plan_items
    SET room_id='00000000-0000-4000-8000-000000000023';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Foreign next-day room allowed'; END IF;

  -- The unique index rejects a second primary, but explicit helper is allowed.
  denied := false;
  BEGIN
    INSERT INTO public.next_day_housekeeping_plan_items(
      plan_id,room_id,assigned_to,recommendation_context) VALUES
     ('00000000-0000-4000-8000-000000000031',
      '00000000-0000-4000-8000-000000000021',
      '00000000-0000-4000-8000-000000000014','{"assignment_role":"primary"}');
  EXCEPTION WHEN unique_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Second primary allowed'; END IF;
  INSERT INTO public.next_day_housekeeping_plan_items(
    plan_id,room_id,assigned_to,recommendation_context) VALUES
   ('00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000014','{"assignment_role":"shared"}');

  -- Existing cross-tenant worker references must NOT be silently deleted.
  IF (SELECT count(*) FROM public.room_assignments) <> 2 THEN
    RAISE EXCEPTION 'Legacy assignment was hidden from own org / deleted';
  END IF;
  UPDATE public.room_assignments SET status='completed'
    WHERE organization_slug='rdhotels' AND status='in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot finish historic mislinked in-progress work'; END IF;

  denied := false;
  BEGIN
    INSERT INTO public.room_assignments(room_id,assigned_to,organization_slug)
      VALUES('00000000-0000-4000-8000-000000000021',
             '00000000-0000-4000-8000-000000000015','rdhotels');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'NEW cross-tenant live staff assignment allowed'; END IF;

  denied := false;
  BEGIN
    INSERT INTO public.room_assignments(room_id,assigned_to,organization_slug)
      VALUES('00000000-0000-4000-8000-000000000024',
             '00000000-0000-4000-8000-000000000014','rdhotels');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'NEW foreign room assignment allowed'; END IF;
  INSERT INTO public.room_assignments(room_id,assigned_to,organization_slug)
    VALUES('00000000-0000-4000-8000-000000000021',
           '00000000-0000-4000-8000-000000000014','rdhotels');
END $$;
ROLLBACK; -- Never modify even the fixture's baseline for next role's tests.

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000015'; -- SLNT housekeeper
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.room_assignments WHERE organization_slug='rdhotels') THEN
    RAISE EXCEPTION 'SLNT worker can read RD assignments via permissive legacy policy';
  END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000013'; -- SLNT manager
DO $$
BEGIN
  IF (SELECT count(*) FROM public.assignment_patterns) <> 1 THEN
    RAISE EXCEPTION 'SLNT manager can see RD patterns';
  END IF;
  IF EXISTS(SELECT 1 FROM public.next_day_housekeeping_plan_items) THEN
    RAISE EXCEPTION 'SLNT manager can see RD next-day plan items';
  END IF;
  IF EXISTS(SELECT 1 FROM public.next_day_housekeeping_plan_staff) THEN
    RAISE EXCEPTION 'SLNT manager can see RD next-day staff';
  END IF;
  IF EXISTS(SELECT 1 FROM public.room_assignments WHERE organization_slug='rdhotels') THEN
    RAISE EXCEPTION 'SLNT manager can read RD live assignments';
  END IF;
END $$;
ROLLBACK;

-- Top management may read/manage authorized properties across its own
-- organization even without an assigned_hotel. It must not access SLNT.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000018';
DO $$
DECLARE denied boolean := false;
BEGIN
  IF (SELECT count(*) FROM public.assignment_patterns) <> 2 THEN
    RAISE EXCEPTION 'RD top management lost authorized two-property access';
  END IF;
  INSERT INTO public.assignment_patterns(organization_slug,hotel)
    VALUES('rdhotels','memories');
  BEGIN
    INSERT INTO public.assignment_patterns(organization_slug,hotel)
      VALUES('slnt','slnt-one');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Top management wrote another tenant pattern'; END IF;
END $$;
ROLLBACK;

-- Explicit super-admin can administer across organizations regardless
-- of their ordinary employee role or assigned hotel.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-4000-8000-000000000019';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.assignment_patterns) <> 3 THEN
    RAISE EXCEPTION 'Explicit super admin lost global pattern read access';
  END IF;
  INSERT INTO public.assignment_patterns(organization_slug,hotel)
    VALUES('slnt','slnt-one');
END $$;
ROLLBACK;

-- NOTE: Two historic RD-labeled records above deliberately include a foreign
-- worker and a foreign room. The tested migration preserves them but does NOT
-- correct the latter row's organization/room mismatch. Reconcile #353 before
-- applying to production or claiming active data is clean.
SELECT 'housekeeping tenant guards passed in disposable CI fixture' AS result;
