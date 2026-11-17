-- Assertions for 20261117200000_access_roles_and_mira_actions.sql.
-- Run after access_roles_fixture.sql and the migration.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid, ''), false);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', _what; END IF;
  RAISE NOTICE 'ok - %', _what;
END $$;

-- 1. Initial roles from the work schedule ------------------------------------
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'Éva_0005') = 'housekeeping_manager', 'housekeeping manager from work schedule');
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'Baska_007') = 'housekeeping_supervisor', 'housekeeping supervisor from work schedule');
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'AsheshK') = 'reception', 'receptionist from work schedule');
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'Petra_006') = 'manager', 'Petra is a manager');
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'Klau_127') = 'manager', 'Klaudia is a manager');
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'Laura_081') = 'controlling', 'Laura is controlling');
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'Brigi_107') IS NULL, 'unlinked manager keeps the derived role');
SELECT pg_temp.expect((SELECT effective_access_role(access_role, role::text) FROM profiles WHERE nickname = 'Brigi_107') = 'manager', 'derived role of an unlinked manager');
SELECT pg_temp.expect((SELECT role::text FROM profiles WHERE nickname = 'AsheshK') = 'manager', 'permission level untouched');
SELECT pg_temp.expect((SELECT effective_access_role(NULL, 'supervisor')) = 'housekeeping_supervisor', 'supervisor permission maps to supervisor role');
SELECT pg_temp.expect(NOT access_role_allows_permission('top_management', 'housekeeping'), 'a housekeeper cannot be labelled top management');

-- 2. Who may set roles -------------------------------------------------------
SET ROLE authenticated;

-- Top management relabels within the same permission level.
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect(set_staff_access_role('10000000-0000-0000-0000-000000000008', 'reception') = 'reception', 'top management sets Reception for a manager-level account');

DO $$ BEGIN
  PERFORM set_staff_access_role('10000000-0000-0000-0000-000000000009', 'top_management');
  RAISE EXCEPTION 'FAILED: housekeeper labelled top management';
EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'ok - role must fit the permission level';
END $$;

DO $$ BEGIN
  PERFORM set_staff_access_role('10000000-0000-0000-0000-000000000001', 'hr');
  RAISE EXCEPTION 'FAILED: changed own role';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - nobody changes their own role';
END $$;

-- Another organization's top manager.
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000012');
DO $$ BEGIN
  PERFORM set_staff_access_role('10000000-0000-0000-0000-000000000008', 'manager');
  RAISE EXCEPTION 'FAILED: cross-organization role change';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - other organizations are refused';
END $$;

-- A manager may update housekeeping profiles through RLS but not their role.
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000003');
DO $$ BEGIN
  PERFORM set_staff_access_role('10000000-0000-0000-0000-000000000006', 'manager');
  RAISE EXCEPTION 'FAILED: manager used the role function';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - managers cannot use the role function';
END $$;
DO $$ BEGIN
  UPDATE profiles SET access_role = 'housekeeping' WHERE id = '10000000-0000-0000-0000-000000000009';
  RAISE EXCEPTION 'FAILED: manager set a role directly';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - direct role writes by managers are refused';
END $$;

-- Admin moves Brigi to the housekeeping level: Reception no longer fits and is reset.
RESET ROLE;
SELECT pg_temp.act_as(NULL);
UPDATE profiles SET role = 'housekeeping' WHERE nickname = 'Brigi_107';
SELECT pg_temp.expect((SELECT access_role FROM profiles WHERE nickname = 'Brigi_107') IS NULL, 'unfitting role is reset when the permission level changes');
UPDATE profiles SET role = 'manager' WHERE nickname = 'Brigi_107';

-- 3. Work schedule scope -----------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000005'); -- Éva switched to Gozsdu for the day
SELECT pg_temp.expect((SELECT hotel_id FROM workforce_access()) = 'memories-budapest', 'housekeeping manager stays on her own hotel');
SELECT pg_temp.expect((SELECT access_level FROM workforce_access()) = 'property', 'housekeeping manager has property access');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM workforce_staff WHERE hotel_id = 'gozsdu-court'), 'no other hotel team for the housekeeping manager');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM workforce_staff WHERE hotel_id = 'memories-budapest' AND full_name = 'Room attendant'), 'own hotel team is visible');

SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000004'); -- Klaudia follows the hotel she picked
SELECT pg_temp.expect((SELECT hotel_id FROM workforce_access()) = 'gozsdu-court', 'manager follows the selected hotel');

-- 4. Staff schedule go-live --------------------------------------------------
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000009');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM workforce_entries), 'housekeeper sees no schedule before go-live');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM workforce_staff), 'housekeeper sees no staff record before go-live');
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000010');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM workforce_entries), 'maintenance sees no schedule before go-live');

SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000005');
DO $$ BEGIN
  PERFORM set_workforce_staff_schedule_live(true);
  RAISE EXCEPTION 'FAILED: housekeeping manager put the schedule live';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - only HR / top management put it live';
END $$;

SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect(set_workforce_staff_schedule_live(true), 'top management puts the schedule live');

SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000009');
SELECT pg_temp.expect((SELECT count(*) FROM workforce_entries) = 1, 'housekeeper sees only their own published shift after go-live');

SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000012');
SELECT pg_temp.expect(NOT workforce_staff_schedule_live('slnt'), 'go-live is per organization');

-- 5. Mira approvals ----------------------------------------------------------
RESET ROLE;
SELECT pg_temp.act_as(NULL);
INSERT INTO assistant_action_requests (id, organization_slug, hotel_id, requested_by, kind, title, plan, plan_hash)
VALUES ('50000000-0000-0000-0000-000000000001', 'rdhotels', 'ottofiori', '10000000-0000-0000-0000-000000000001',
        'rate_plan', 'Rate plan', '{"dates":[]}', repeat('a', 64));

DO $$ BEGIN
  UPDATE assistant_action_requests SET plan = '{"dates":[1]}' WHERE id = '50000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAILED: plan changed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - the plan is immutable';
END $$;

DO $$ BEGIN
  UPDATE assistant_action_requests SET status = 'applied' WHERE id = '50000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAILED: skipped the decision';
EXCEPTION WHEN check_violation OR invalid_parameter_value THEN RAISE NOTICE 'ok - cannot skip the decision';
END $$;

UPDATE assistant_action_requests
   SET status = 'approved', decided_by = '10000000-0000-0000-0000-000000000001', decided_by_name = 'Anu',
       decided_at = now(), approved_items = '["2026-11-20"]', consent_text = 'I approve'
 WHERE id = '50000000-0000-0000-0000-000000000001';

DO $$ BEGIN
  UPDATE assistant_action_requests SET consent_text = 'changed' WHERE id = '50000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FAILED: consent edited';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - the recorded consent cannot be edited';
END $$;

UPDATE assistant_action_requests SET status = 'applying' WHERE id = '50000000-0000-0000-0000-000000000001';
UPDATE assistant_action_requests SET status = 'applied', result = '{"queued":3}' WHERE id = '50000000-0000-0000-0000-000000000001';

SET ROLE authenticated;
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000001');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM assistant_action_requests), 'requester reads the approval record');
SELECT pg_temp.act_as('10000000-0000-0000-0000-000000000003');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM assistant_action_requests), 'other managers do not see it');
DO $$ BEGIN
  INSERT INTO assistant_action_requests (organization_slug, hotel_id, requested_by, kind, title, plan, plan_hash)
  VALUES ('rdhotels', 'ottofiori', '10000000-0000-0000-0000-000000000003', 'rate_plan', 'x', '{}', repeat('b', 64));
  RAISE EXCEPTION 'FAILED: browser inserted a request';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok - requests are written only by Edge Functions';
END $$;

RESET ROLE;
\echo 'access roles: all assertions passed'
