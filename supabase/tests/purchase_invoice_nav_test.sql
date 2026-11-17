-- Purchase-invoice NAV migration: tenancy, rollout, approval and integrity tests.
-- Every failure raises, so psql -v ON_ERROR_STOP=1 fails the CI job.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS t;
GRANT USAGE ON SCHEMA t TO authenticated;
CREATE OR REPLACE FUNCTION t.expect_error(_sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~* _pattern THEN
      RAISE EXCEPTION 'Expected error matching "%" but got "%" for: %', _pattern, SQLERRM, _sql;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'Expected an error matching "%" for: %', _pattern, _sql;
END $$;
CREATE OR REPLACE FUNCTION t.eq(_actual anyelement, _expected anyelement, _label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _actual IS DISTINCT FROM _expected THEN
    RAISE EXCEPTION 'FAIL %: expected %, got %', _label, _expected, _actual;
  END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO authenticated;

-- ---------------------------------------------------------------- seed (server)
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.organizations (slug) VALUES ('disabledorg') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, role, organization_slug, assigned_hotel, nickname) VALUES
 ('00000000-0000-4000-8000-000000000001','admin','rdhotels',NULL,NULL),
 ('00000000-0000-4000-8000-000000000002','control_finance','rdhotels',NULL,NULL),
 ('00000000-0000-4000-8000-000000000003','top_management','rdhotels',NULL,NULL),
 ('00000000-0000-4000-8000-000000000004','back_office','rdhotels','memories',NULL),
 ('00000000-0000-4000-8000-000000000005','reception','rdhotels','memories',NULL),
 ('00000000-0000-4000-8000-000000000006','admin','otherorg',NULL,NULL),
 ('00000000-0000-4000-8000-000000000007','admin','disabledorg',NULL,'Anu_000'),
 ('00000000-0000-4000-8000-000000000008','admin','disabledorg',NULL,NULL),
 ('00000000-0000-4000-8000-000000000009','control_finance','rdhotels',NULL,NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.invoice_buyer_companies (id, organization_slug, name, legal_name, tax_id) VALUES
 ('10000000-0000-4000-8000-000000000001','rdhotels','RD Hotel Kft','RD Hotel Kft','12345676-2-42'),
 ('10000000-0000-4000-8000-000000000002','rdhotels','Gozsdu Hotel Kft','Gozsdu Hotel Kft','23456781-2-42'),
 ('10000000-0000-4000-8000-000000000003','otherorg','Other Kft','Other Kft','34567896-2-42');

INSERT INTO public.finance_access (id, user_id, organization_slug, profile) VALUES
 ('20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','rdhotels','controller'),
 ('20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','rdhotels','chief_controller'),
 ('20000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000009','rdhotels','controller');
-- Controller 9 is scoped to the second legal company only.
INSERT INTO public.finance_access_companies (finance_access_id, company_id) VALUES
 ('20000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000002');

INSERT INTO public.pi_module_settings (organization_slug, module_enabled) VALUES ('rdhotels', true), ('otherorg', true);

INSERT INTO public.purchase_invoices (id, organization_slug, hotel_id, uploaded_by, file_path, status, review_status,
  nav_match_status, merchant_tax_id, invoice_number, total_amount, net_amount, total_vat_amount, currency, buyer_company_id) VALUES
 ('30000000-0000-4000-8000-000000000001','rdhotels','memories','00000000-0000-4000-8000-000000000005','rdhotels/memories/i1.pdf','processed','pending_approval','exact_match','10773381-2-44','SZ-1',127000,100000,27000,'HUF','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000002','rdhotels','memories','00000000-0000-4000-8000-000000000005','rdhotels/memories/i2.pdf','processed','pending_approval','data_mismatch','10773381-2-44','SZ-2',172000,100000,72000,'HUF','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000003','rdhotels','memories','00000000-0000-4000-8000-000000000004','rdhotels/memories/i3.pdf','processed','pending_approval','exact_match','10773381','sz 1',127000,100000,27000,'HUF','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000004','rdhotels','memories','00000000-0000-4000-8000-000000000005','rdhotels/memories/i4.pdf','processed','pending_review','exact_match',NULL,'SZ-4',127000,100000,NULL,'HUF','10000000-0000-4000-8000-000000000001'),
 ('30000000-0000-4000-8000-000000000005','otherorg',NULL,'00000000-0000-4000-8000-000000000006','otherorg/x/i5.pdf','processed','pending_review','not_checked','10773381','O-1',5000,NULL,NULL,'HUF','10000000-0000-4000-8000-000000000003'),
 ('30000000-0000-4000-8000-000000000006','disabledorg',NULL,'00000000-0000-4000-8000-000000000008','disabledorg/x/i6.pdf','processed','pending_review','not_checked','10773381','D-1',5000,NULL,NULL,'HUF',NULL);

INSERT INTO storage.objects (bucket_id, name) VALUES
 ('purchase-invoices','rdhotels/memories/i1.pdf'), ('purchase-invoices','rdhotels/memories/i2.pdf'),
 ('purchase-invoices','otherorg/x/i5.pdf');

INSERT INTO public.pi_nav_connections (id, organization_slug, company_id, environment, tax_number, credentials_set, enabled, use_for_reconciliation)
VALUES ('40000000-0000-4000-8000-000000000001','rdhotels','10000000-0000-4000-8000-000000000001','test','12345676',true,false,true),
       ('40000000-0000-4000-8000-000000000003','otherorg','10000000-0000-4000-8000-000000000003','test','34567896',true,false,true);
INSERT INTO public.pi_nav_connection_secrets (connection_id, credential_ciphertext, credential_iv)
VALUES ('40000000-0000-4000-8000-000000000001','CIPHERTEXT','IV');

INSERT INTO public.pi_nav_invoices (id, organization_slug, company_id, connection_id, environment, source_key, hotel_id,
  supplier_tax_number, customer_tax_number, invoice_number, invoice_operation, invoice_issue_date, currency, net_amount, vat_amount, gross_amount, ins_date) VALUES
 ('50000000-0000-4000-8000-000000000001','rdhotels','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','test','k1','memories','10773381','12345676','SZ-1','CREATE','2026-10-01','HUF',100000,27000,127000,'2026-10-01T10:00:00Z'),
 ('50000000-0000-4000-8000-000000000002','rdhotels','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','test','k2','memories','10773381','12345676','SZ-9','CREATE','2026-10-02','HUF',1000,270,1270,'2026-10-02T10:00:00Z'),
 ('50000000-0000-4000-8000-000000000003','otherorg','10000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000003','test','k3',NULL,'10773381','34567896','O-1','CREATE','2026-10-02','HUF',1000,270,1270,'2026-10-02T10:00:00Z');

-- ------------------------------------------------- credentials are unreadable
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
SELECT t.expect_error('SELECT * FROM public.pi_nav_connection_secrets', 'permission denied');
SELECT t.expect_error('SELECT public.nav_credential_key_internal()', 'permission denied');
SELECT t.expect_error('SELECT public.get_purchase_invoice_worker_secret()', 'permission denied');
SELECT t.expect_error('SELECT public.pi_apply_reconciliation(''rdhotels'', ''[]''::jsonb, ''[]''::jsonb)', 'permission denied');
SELECT t.expect_error('SELECT public.pi_module_access_for(''00000000-0000-4000-8000-000000000003'')', 'permission denied');

-- ------------------------------------------------------- tenant isolation
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000006', false);  -- otherorg admin
SELECT t.eq((SELECT count(*) FROM public.purchase_invoices WHERE organization_slug = 'rdhotels'), 0::bigint, 'other org cannot read invoices');
SELECT t.eq((SELECT count(*) FROM public.pi_nav_invoices WHERE organization_slug = 'rdhotels'), 0::bigint, 'other org cannot read NAV data');
SELECT t.eq((SELECT count(*) FROM public.pi_nav_connections WHERE organization_slug = 'rdhotels'), 0::bigint, 'other org cannot read NAV connections');
SELECT t.eq((SELECT count(*) FROM storage.objects WHERE name LIKE 'rdhotels/%'), 0::bigint, 'other org cannot read invoice files');
SELECT t.eq((SELECT count(*) FROM storage.objects WHERE name = 'otherorg/x/i5.pdf'), 1::bigint, 'own org file readable');
UPDATE public.pi_module_settings SET module_enabled = false WHERE organization_slug = 'rdhotels';
SELECT t.eq((SELECT module_enabled FROM public.pi_module_settings WHERE organization_slug = 'rdhotels'), NULL::boolean, 'cannot even see other org settings');
RESET ROLE;
SELECT t.eq((SELECT module_enabled FROM public.pi_module_settings WHERE organization_slug = 'rdhotels'), true, 'other org cannot change settings');
SET ROLE authenticated;

-- -------------------------------------------------------- module rollout gate
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000008', false);  -- admin, module disabled
SELECT t.eq(public.pi_module_access(), false, 'module disabled for org');
SELECT t.eq((SELECT count(*) FROM public.purchase_invoices), 0::bigint, 'disabled module hides invoices even from admins');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000007', false);  -- legacy Anu_000 owner
SELECT t.eq(public.pi_module_access(), true, 'legacy owner keeps access');
SELECT t.eq((SELECT count(*) FROM public.purchase_invoices), 1::bigint, 'legacy owner sees own org only');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', false);  -- reception, not in allowed roles
SELECT t.eq(public.pi_module_access(), false, 'reception not rolled out by default');
SELECT t.eq((SELECT count(*) FROM public.purchase_invoices), 0::bigint, 'reception without rollout sees nothing');
RESET ROLE;
UPDATE public.pi_module_settings SET allowed_roles = allowed_roles || ARRAY['reception'] WHERE organization_slug = 'rdhotels';
SET ROLE authenticated;
SELECT t.eq((SELECT count(*) FROM public.purchase_invoices), 3::bigint, 'reception sees only own uploads after rollout');
SELECT t.eq((SELECT count(*) FROM public.pi_nav_invoices), 0::bigint, 'reception cannot see NAV data');
SELECT t.eq((SELECT count(*) FROM storage.objects WHERE name = 'rdhotels/memories/i1.pdf'), 1::bigint, 'reception reads own invoice file');

-- ------------------------------------------- browser inserts cannot forge state
INSERT INTO public.purchase_invoices (id, organization_slug, hotel_id, uploaded_by, file_path, status, approval_status, nav_match_status, review_status)
VALUES ('30000000-0000-4000-8000-000000000099','rdhotels','memories','00000000-0000-4000-8000-000000000005','rdhotels/memories/i99.pdf','uploaded','approved','exact_match','pending_approval');
RESET ROLE;
SELECT t.eq((SELECT approval_status || '/' || nav_match_status || '/' || review_status FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000099'),
  'none/not_checked/pending_review', 'insert guard resets approval and reconciliation state');
SELECT t.eq((SELECT status FROM public.pi_processing_jobs WHERE invoice_id = '30000000-0000-4000-8000-000000000099'), 'queued', 'upload creates a processing job immediately');
SET ROLE authenticated;
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET review_status = 'pending_approval' WHERE id = '30000000-0000-4000-8000-000000000004'$q$, 'Only finance reviewers');

-- ------------------------------------------------------------ approval rules
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);  -- admin without controller profile
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'approved' WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'Only a controller');
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET nav_match_status = 'exact_match' WHERE id = '30000000-0000-4000-8000-000000000002'$q$, 'maintained by HotelCare');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000009', false);  -- controller scoped to other company
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'approved' WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'in scope|0 rows|no rows');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);  -- controller
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'approved' WHERE id = '30000000-0000-4000-8000-000000000002'$q$, 'NAV reconciliation exception');
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'approved', total_amount = 1 WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'same step as approval');
UPDATE public.purchase_invoices SET approval_status = 'approved', approved_by = '00000000-0000-4000-8000-000000000005' WHERE id = '30000000-0000-4000-8000-000000000001';
SELECT t.eq((SELECT approved_by FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000002'::uuid, 'approver is set server-side');
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET total_amount = 1 WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'locked');
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approved_at = now() WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'locked');
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'approved' WHERE id = '30000000-0000-4000-8000-000000000003'$q$, 'duplicate approval');
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'none', review_status = 'pending_review', reopen_reason = 'fix' WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'chief controller');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);  -- admin may delete, but not approved records
SELECT t.expect_error($q$DELETE FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'cannot be deleted');
DELETE FROM storage.objects WHERE name = 'rdhotels/memories/i1.pdf';
RESET ROLE;
SELECT t.eq((SELECT count(*) FROM storage.objects WHERE name = 'rdhotels/memories/i1.pdf'), 1::bigint, 'approved invoice file cannot be deleted');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);

-- Server processes may refresh reconciliation metadata on locked invoices, nothing else.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.purchase_invoices SET nav_last_checked_at = now(), nav_match_score = 1 WHERE id = '30000000-0000-4000-8000-000000000001';
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET total_amount = 2 WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'locked');
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'approved' WHERE id = '30000000-0000-4000-8000-000000000003'$q$, 'not by automated processes');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', false);  -- chief controller
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'none', review_status = 'pending_review' WHERE id = '30000000-0000-4000-8000-000000000001'$q$, 'requires a reason');
UPDATE public.purchase_invoices SET approval_status = 'none', review_status = 'pending_review', reopen_reason = 'Wrong cost centre'
 WHERE id = '30000000-0000-4000-8000-000000000001';
SELECT t.eq((SELECT reopened_by FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000003'::uuid, 'reopen recorded');
SELECT t.eq((SELECT count(*) FROM public.purchase_invoice_audit_log WHERE invoice_id = '30000000-0000-4000-8000-000000000001' AND action IN ('approval_approved','approval_none')), 2::bigint, 'approval and reopen audited');

-- Rejection requires a reason and a controller.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'rejected' WHERE id = '30000000-0000-4000-8000-000000000002'$q$, 'rejection reason');
UPDATE public.purchase_invoices SET approval_status = 'rejected', rejection_reason = 'Amount differs from NAV', review_status = 'pending_review'
 WHERE id = '30000000-0000-4000-8000-000000000002';

-- --------------------------------------------- reconciliation writer + follow-ups
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.pi_apply_reconciliation('rdhotels',
  '[{"id":"30000000-0000-4000-8000-000000000004","status":"exact_match","nav_invoice_id":"50000000-0000-4000-8000-000000000001","score":1,"reason":null,"explanation":[],"differences":[],"duplicate_of":null,"company_id":"10000000-0000-4000-8000-000000000001"},
    {"id":"30000000-0000-4000-8000-000000000005","status":"exact_match","nav_invoice_id":null,"score":1,"reason":null,"explanation":[],"differences":[],"duplicate_of":null,"company_id":null}]'::jsonb,
  '[{"id":"50000000-0000-4000-8000-000000000001","status":"exact_match","document_id":"30000000-0000-4000-8000-000000000004","score":1,"reason":null,"explanation":[],"duplicate_document_ids":[]},
    {"id":"50000000-0000-4000-8000-000000000002","status":"nav_only","document_id":null,"score":0,"reason":"document_missing","explanation":[],"duplicate_document_ids":[]},
    {"id":"50000000-0000-4000-8000-000000000003","status":"nav_only","document_id":null,"score":0,"reason":"document_missing","explanation":[],"duplicate_document_ids":[]}]'::jsonb);
SELECT t.eq((SELECT nav_match_status FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000005'), 'not_checked', 'writer never touches another organization');
SELECT t.eq((SELECT match_status FROM public.pi_nav_invoices WHERE id = '50000000-0000-4000-8000-000000000003'), 'nav_only', 'other org NAV untouched (default)');
SELECT t.eq((SELECT count(*) FROM public.pi_missing_document_followups WHERE organization_slug = 'otherorg'), 0::bigint, 'no cross-org follow-ups');
SELECT t.eq((SELECT status FROM public.pi_missing_document_followups WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000002'), 'open', 'NAV-only creates follow-up');
SELECT t.eq((SELECT count(*) FROM public.pi_reconciliation_events WHERE invoice_id = '30000000-0000-4000-8000-000000000004' AND action = 'document_status'), 1::bigint, 'document status change audited');
SELECT t.eq((SELECT count(*) FROM public.pi_reconciliation_events WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000001' AND action = 'nav_status'), 1::bigint, 'NAV status change audited');

-- Gap fill: only empty fields, provenance kept, conflict blocks approval.
SELECT public.pi_apply_gap_fill('rdhotels', '[{"invoice_id":"30000000-0000-4000-8000-000000000004","nav_invoice_id":"50000000-0000-4000-8000-000000000001",
  "fills":{"merchant_tax_id":"10773381-2-44","total_vat_amount":27000,"total_amount":999},
  "vat_lines":[{"vat_kind":"standard_27","vat_rate":27,"vat_base":100000,"vat_amount":27000}],
  "provenance":[{"field":"merchant_tax_id","documentValue":null,"navValue":"10773381-2-44","finalValue":"10773381-2-44","action":"fill","rule":"verified_supplier_tax_number","material":true},
                {"field":"invoice_date","documentValue":"2026-10-05","navValue":"2026-10-01","finalValue":"2026-10-05","action":"conflict","rule":"document_and_nav_differ","material":true}]}]'::jsonb);
SELECT t.eq((SELECT merchant_tax_id FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000004'), '10773381-2-44', 'empty field filled from NAV');
SELECT t.eq((SELECT total_amount FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000004'), 127000::numeric, 'existing value never overwritten');
SELECT t.eq((SELECT count(*) FROM public.purchase_invoice_vat_lines WHERE invoice_id = '30000000-0000-4000-8000-000000000004'), 1::bigint, 'VAT lines from NAV');
SELECT t.eq(public.pi_open_conflict_count('30000000-0000-4000-8000-000000000004'), 1, 'conflict open');
SELECT t.eq((SELECT count(*) FROM public.purchase_invoice_audit_log WHERE invoice_id = '30000000-0000-4000-8000-000000000004' AND action = 'system_update' AND field = 'merchant_tax_id'), 1::bigint, 'gap fill audited');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);  -- back office submits
UPDATE public.purchase_invoices SET review_status = 'pending_approval' WHERE id = '30000000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
SELECT t.expect_error($q$UPDATE public.purchase_invoices SET approval_status = 'approved' WHERE id = '30000000-0000-4000-8000-000000000004'$q$, 'field conflicts');

-- A match change supersedes old conflicts.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.pi_apply_reconciliation('rdhotels',
  '[{"id":"30000000-0000-4000-8000-000000000004","status":"nav_sync_pending","nav_invoice_id":null,"score":0,"reason":"waiting","explanation":[],"differences":[],"duplicate_of":null,"company_id":"10000000-0000-4000-8000-000000000001"}]'::jsonb,
  '[{"id":"50000000-0000-4000-8000-000000000001","status":"nav_only","document_id":null,"score":0,"reason":"document_missing","explanation":[],"duplicate_document_ids":[]},
    {"id":"50000000-0000-4000-8000-000000000002","status":"exact_match","document_id":"30000000-0000-4000-8000-000000000003","score":1,"reason":null,"explanation":[],"duplicate_document_ids":[]}]'::jsonb);
SELECT t.eq(public.pi_open_conflict_count('30000000-0000-4000-8000-000000000004'), 0, 'stale conflicts superseded');
SELECT t.eq((SELECT status || '/' || resolution FROM public.pi_missing_document_followups WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000002'), 'resolved/document_matched', 'follow-up auto-resolved on match');

-- Assignee may only move a follow-up to in_progress.
UPDATE public.pi_missing_document_followups SET assigned_to = '00000000-0000-4000-8000-000000000005' WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000001';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000005', false);
UPDATE public.pi_missing_document_followups SET status = 'in_progress' WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000001';
SELECT t.expect_error($q$UPDATE public.pi_missing_document_followups SET status = 'resolved' WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000001'$q$, 'Only controlling');
INSERT INTO public.pi_missing_document_notes (followup_id, organization_slug, author_id, note)
SELECT id, 'rdhotels', '00000000-0000-4000-8000-000000000005', 'Asked the supplier for a copy' FROM public.pi_missing_document_followups WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', false);
UPDATE public.pi_missing_document_followups SET status = 'resolved', resolution = 'not_required' WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000001';
SELECT t.eq((SELECT resolved_by FROM public.pi_missing_document_followups WHERE nav_invoice_id = '50000000-0000-4000-8000-000000000001'), '00000000-0000-4000-8000-000000000002'::uuid, 'resolver recorded');

-- ------------------------------------------------ deletions are archived
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', false);
DELETE FROM public.purchase_invoices WHERE id = '30000000-0000-4000-8000-000000000099';
RESET ROLE;
SELECT t.eq((SELECT count(*) FROM public.pi_deleted_invoices WHERE invoice_id = '30000000-0000-4000-8000-000000000099'), 1::bigint, 'deletion archived with snapshot');

-- ------------------------------------------- idempotent job and sync claims
SELECT t.eq((SELECT claimed FROM public.pi_claim_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001')), true, 'first claim wins');
SELECT t.eq((SELECT claimed FROM public.pi_claim_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000002')), false, 'concurrent claim loses');
SELECT public.pi_finish_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000002', true);
SELECT t.eq((SELECT status FROM public.pi_processing_jobs WHERE invoice_id = '30000000-0000-4000-8000-000000000004'), 'running', 'stale token cannot finish');
SELECT public.pi_finish_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000001', true);
SELECT t.eq((SELECT status FROM public.pi_processing_jobs WHERE invoice_id = '30000000-0000-4000-8000-000000000004'), 'succeeded', 'owner finishes');
SELECT t.eq((SELECT claimed FROM public.pi_claim_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000003')), false, 'succeeded job not re-run automatically');
SELECT t.eq((SELECT claimed FROM public.pi_claim_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000003', true)), true, 'explicit retry allowed');
-- A re-queued job waiting for its back-off can be retried explicitly by a person.
SELECT public.pi_finish_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000003', false, 'AI_UNAVAILABLE', 'provider 503');
SELECT t.eq((SELECT status FROM public.pi_processing_jobs WHERE invoice_id = '30000000-0000-4000-8000-000000000004'), 'queued', 'transient failure re-queued');
SELECT t.eq((SELECT claimed FROM public.pi_claim_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000004')), false, 'worker waits for back-off');
SELECT t.eq((SELECT claimed FROM public.pi_claim_processing_job('30000000-0000-4000-8000-000000000004', '60000000-0000-4000-8000-000000000004', true)), true, 'manual retry overrides back-off');
SELECT t.eq(public.pi_claim_nav_sync('40000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'), true, 'sync lock acquired');
SELECT t.eq(public.pi_claim_nav_sync('40000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002'), false, 'overlapping sync refused');
SELECT public.pi_release_nav_sync('40000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001');
SELECT t.eq(public.pi_claim_nav_sync('40000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002'), true, 'lock reusable after release');

-- Reconciliation runs are serialized per organization and coalesce requests.
SELECT t.eq(public.pi_claim_reconcile('rdhotels', '71000000-0000-4000-8000-000000000001'), true, 'reconcile lock acquired');
SELECT t.eq(public.pi_claim_reconcile('rdhotels', '71000000-0000-4000-8000-000000000002'), false, 'concurrent reconcile coalesced');
SELECT t.eq(public.pi_release_reconcile('rdhotels', '71000000-0000-4000-8000-000000000002', 'completed', '{}'::jsonb, NULL), false, 'foreign token cannot release');
SELECT t.eq(public.pi_release_reconcile('rdhotels', '71000000-0000-4000-8000-000000000001', 'completed', '{"documents":3}'::jsonb, NULL), true, 'release reports the coalesced request');
SELECT t.eq(public.pi_claim_reconcile('rdhotels', '71000000-0000-4000-8000-000000000003'), true, 'follow-up run claims the lock');
SELECT t.eq(public.pi_release_reconcile('rdhotels', '71000000-0000-4000-8000-000000000003', 'completed', '{}'::jsonb, NULL), false, 'nothing pending after follow-up');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);
SELECT t.expect_error($q$SELECT public.pi_claim_reconcile('rdhotels', gen_random_uuid())$q$, 'permission denied');
RESET ROLE;

-- ------------------------------------------- legal-entity writes are admin-only
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000004', false);  -- back office
SELECT t.expect_error($q$INSERT INTO public.invoice_buyer_companies (organization_slug, name, tax_id) VALUES ('rdhotels','Fake Kft','99999999')$q$, 'row-level security');
RESET ROLE;

SELECT 'purchase_invoice_nav_test: all assertions passed' AS result;
