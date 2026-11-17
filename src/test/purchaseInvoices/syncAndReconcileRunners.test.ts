/* eslint-disable @typescript-eslint/no-explicit-any -- captured RPC payloads */
import { beforeEach, describe, expect, it } from 'vitest';
import { syncConnection, type NavConnectionRow } from '../../../supabase/functions/_shared/purchaseInvoices/navSyncRunner';
import { encryptNavCredentials } from '../../../supabase/functions/_shared/purchaseInvoices/navCredentials';
import { reconcileOrganization, runReconciliation } from '../../../supabase/functions/_shared/purchaseInvoices/reconcileRunner';
import { FakeSupabase } from './fakeSupabase';
import {
  digestResponseXml, errorResponseXml, invoiceDataResponseXml, invoiceDataXml, TEST_AUTH, validTaxCore, type DigestFixture,
} from './navFixtures';

const ORG = 'rdhotels';
const BUYER = TEST_AUTH.taxNumber;
const SUP = validTaxCore('2400000');
const KEY_B64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256)));
const ENV: Record<string, string> = {
  NAV_SOFTWARE_DEV_TAX_NUMBER: '12345676', NAV_SOFTWARE_DEV_NAME: 'HotelCare Test', NAV_SOFTWARE_DEV_CONTACT: 'dev@example.test',
};
const noSleep = async () => {};

function navDataset(): DigestFixture[] {
  return [
    { invoiceNumber: 'INV-1', supplierTaxNumber: SUP, customerTaxNumber: BUYER, invoiceIssueDate: '2026-09-10', insDate: '2026-09-10T09:00:00.000Z', invoiceNetAmount: 100000, invoiceVatAmount: 27000, transactionId: 'T1' },
    { invoiceNumber: 'INV-2', supplierTaxNumber: SUP, customerTaxNumber: BUYER, invoiceIssueDate: '2026-10-20', insDate: '2026-10-20T09:00:00.000Z', invoiceNetAmount: 50000, invoiceVatAmount: 13500, transactionId: 'T2' },
    { invoiceNumber: 'INV-3', supplierTaxNumber: SUP, customerTaxNumber: BUYER, invoiceIssueDate: '2026-11-15', insDate: '2026-11-15T09:00:00.000Z', invoiceNetAmount: 1000, invoiceVatAmount: 270, transactionId: 'T3' },
  ];
}

/** Synthetic NAV endpoint: filters the dataset by the requested window and pages by 2. */
function fakeNav(dataset: DigestFixture[], calls: string[], failWith?: string): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const op = String(url).split('/').pop()!;
    const body = String(init?.body ?? '');
    calls.push(op);
    if (failWith) return new Response(errorResponseXml(failWith), { status: 500 });
    if (op === 'queryInvoiceDigest') {
      const page = Number(body.match(/<page>(\d+)<\/page>/)?.[1] ?? 1);
      const issue = body.match(/<dateFrom>([^<]+)<\/dateFrom><dateTo>([^<]+)<\/dateTo>/);
      const ins = body.match(/<dateTimeFrom>([^<]+)<\/dateTimeFrom><dateTimeTo>([^<]+)<\/dateTimeTo>/);
      const hits = dataset.filter((d) => issue
        ? d.invoiceIssueDate! >= issue[1] && d.invoiceIssueDate! <= issue[2]
        : ins ? d.insDate! >= ins[1] && d.insDate! <= ins[2] : false);
      const pages = Math.max(1, Math.ceil(hits.length / 2));
      return new Response(digestResponseXml(hits.slice((page - 1) * 2, page * 2), page, pages), { status: 200 });
    }
    if (op === 'queryInvoiceData') {
      const number = body.match(/<invoiceNumber>([^<]+)<\/invoiceNumber>/)![1];
      const d = dataset.find((x) => x.invoiceNumber === number)!;
      const xml = invoiceDataXml({
        invoiceNumber: number, issueDate: d.invoiceIssueDate, supplierTax: [SUP, '2', '42'], customerTax: [BUYER, '2', '42'],
        vatLines: [{ rate: '0.27', net: d.invoiceNetAmount!, vat: d.invoiceVatAmount! }],
      });
      return new Response(invoiceDataResponseXml(btoa(unescape(encodeURIComponent(xml))), false), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

async function setup(conn: Partial<NavConnectionRow> = {}) {
  const db = new FakeSupabase();
  db.defaults('pi_nav_invoices', { detail_status: 'digest_only', detail_attempts: 0, vat_breakdown: [], line_items: [] });
  db.rpcs.set('nav_credential_key_internal', () => KEY_B64);
  db.rpcs.set('pi_claim_nav_sync', (a, d) => {
    const c = d.table('pi_nav_connections').find((r) => r.id === a._connection_id)!;
    if (c.sync_lock_until && Date.parse(c.sync_lock_until) > Date.now()) return false;
    Object.assign(c, { sync_lock_until: new Date(Date.now() + 60_000).toISOString(), sync_lock_token: a._lock_token, last_attempt_at: new Date().toISOString() });
    return true;
  });
  db.rpcs.set('pi_release_nav_sync', (a, d) => {
    const c = d.table('pi_nav_connections').find((r) => r.id === a._connection_id)!;
    if (c.sync_lock_token === a._lock_token) Object.assign(c, { sync_lock_until: null, sync_lock_token: null });
  });
  const row: NavConnectionRow = {
    id: '11111111-1111-4111-8111-111111111111', organization_slug: ORG, company_id: 'co-1', environment: 'test', tax_number: BUYER,
    enabled: true, sync_from_date: '2026-09-01', initial_sync_through: null, initial_sync_completed_at: null, ins_date_cursor: null,
    last_backfill_at: null, consecutive_failures: 0, ...conn,
  };
  db.seed('pi_nav_connections', [row]);
  db.seed('invoice_company_properties', [{ company_id: 'co-1', hotel_id: 'hotel-a', organization_slug: ORG }]);
  db.seed('pi_nav_connection_secrets', [{ connection_id: row.id, ...(await encryptNavCredentials({ login: TEST_AUTH.login, password: TEST_AUTH.password, signingKey: TEST_AUTH.signingKey }, row.id, db)) }]);
  return { db, row };
}

describe('NAV sync runner', () => {
  it('loads history in resumable windows, stores normalized records and enriches details', async () => {
    const { db, row } = await setup();
    const calls: string[] = [];
    const out = await syncConnection(db, row, { trigger: 'initial', deadlineMs: Date.now() + 60_000, fetchImpl: fakeNav(navDataset(), calls), getEnv: (k) => ENV[k], sleep: noSleep });
    expect(out).toMatchObject({ status: 'completed', digests: 3, upserted: 3, details: 3, detailsFailed: 0 });
    const nav = db.table('pi_nav_invoices');
    expect(nav.map((n) => n.invoice_number).sort()).toEqual(['INV-1', 'INV-2', 'INV-3']);
    expect(nav.every((n) => n.environment === 'test' && n.company_id === 'co-1' && n.hotel_id === 'hotel-a')).toBe(true);
    expect(nav.find((n) => n.invoice_number === 'INV-1')).toMatchObject({ gross_amount: 127000, detail_status: 'detail_fetched' });
    expect(nav.find((n) => n.invoice_number === 'INV-1')!.vat_breakdown[0]).toMatchObject({ net: 100000, vat: 27000 });
    const conn = db.table('pi_nav_connections')[0];
    expect(conn.initial_sync_completed_at).toBeTruthy();
    expect(conn.ins_date_cursor).toBeTruthy();
    expect(conn).toMatchObject({ consecutive_failures: 0, last_sync_state: 'full', status: 'active', sync_lock_token: null });
    expect(db.table('pi_nav_sync_runs')[0]).toMatchObject({ status: 'completed', digests_received: 3, records_upserted: 3, details_fetched: 3 });
    // Read-only: no manage/token operations are ever called.
    expect(new Set(calls)).toEqual(new Set(['queryInvoiceDigest', 'queryInvoiceData']));
  });

  it('is idempotent: a repeated sync does not duplicate NAV records', async () => {
    const { db, row } = await setup();
    const opts = { trigger: 'manual' as const, deadlineMs: Date.now() + 60_000, fetchImpl: fakeNav(navDataset(), []), getEnv: (k: string) => ENV[k], sleep: noSleep };
    await syncConnection(db, row, opts);
    const after = db.table('pi_nav_connections')[0] as NavConnectionRow;
    const second = await syncConnection(db, { ...after }, { ...opts, forceBackfill: true });
    expect(second.status).toBe('completed');
    expect(db.table('pi_nav_invoices')).toHaveLength(3);
  });

  it('records an authentication failure with a 24h back-off and keeps no partial lock', async () => {
    const { db, row } = await setup();
    const out = await syncConnection(db, row, { trigger: 'schedule', deadlineMs: Date.now() + 60_000, fetchImpl: fakeNav([], [], 'INVALID_SECURITY_USER'), getEnv: (k) => ENV[k], sleep: noSleep });
    expect(out.status).toBe('failed');
    expect(out.error).toMatchObject({ code: 'INVALID_SECURITY_USER', category: 'auth' });
    const conn = db.table('pi_nav_connections')[0];
    expect(conn).toMatchObject({ consecutive_failures: 1, status: 'error', last_error_code: 'INVALID_SECURITY_USER', sync_lock_token: null });
    expect(Date.parse(conn.next_retry_at) - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(db.table('pi_nav_invoices')).toHaveLength(0);
  });

  it('stops at the time budget with a partial, resumable state', async () => {
    const { db, row } = await setup();
    const out = await syncConnection(db, row, { trigger: 'initial', deadlineMs: Date.now() - 1, fetchImpl: fakeNav(navDataset(), []), getEnv: (k) => ENV[k], sleep: noSleep });
    expect(out.status).toBe('partial');
    expect(db.table('pi_nav_connections')[0].initial_sync_completed_at ?? null).toBeNull();
  });

  it('skips when another sync holds the lock', async () => {
    const { db, row } = await setup();
    db.table('pi_nav_connections')[0].sync_lock_until = new Date(Date.now() + 60_000).toISOString();
    const out = await syncConnection(db, row, { trigger: 'schedule', deadlineMs: Date.now() + 60_000, fetchImpl: fakeNav(navDataset(), []), getEnv: (k) => ENV[k], sleep: noSleep });
    expect(out.status).toBe('skipped');
    expect(db.table('pi_nav_sync_runs')).toHaveLength(0);
  });

  it('refuses to sync without stored credentials', async () => {
    const { db, row } = await setup();
    db.tables.set('pi_nav_connection_secrets', []);
    const out = await syncConnection(db, row, { trigger: 'schedule', deadlineMs: Date.now() + 60_000, fetchImpl: fakeNav(navDataset(), []), getEnv: (k) => ENV[k], sleep: noSleep });
    expect(out).toMatchObject({ status: 'failed', error: { category: 'config' } });
  });
});

describe('reconciliation runner', () => {
  let db: FakeSupabase;
  let applied: any;
  let gapItems: any[];
  beforeEach(() => {
    db = new FakeSupabase();
    applied = null;
    gapItems = [];
    db.rpcs.set('pi_apply_reconciliation', (a) => { applied = a; return { documents_changed: a._documents.length, nav_changed: a._nav.length, followups_opened: 0, followups_closed: 0 }; });
    db.rpcs.set('pi_apply_gap_fill', (a) => { gapItems.push(...a._items); return { applied: a._items.length, skipped_approved: 0 }; });
    db.seed('pi_module_settings', [{ organization_slug: ORG, auto_apply_gap_fill: true, reporting_delay_days: 5, reconciliation_start_date: null }]);
    db.seed('invoice_buyer_companies', [{ id: 'co-1', organization_slug: ORG, tax_id: `${BUYER}-2-42`, is_active: true }]);
    db.seed('pi_nav_connections', [
      { id: 'conn-test', organization_slug: ORG, company_id: 'co-1', environment: 'test', use_for_reconciliation: true, sync_from_date: '2026-01-01', initial_sync_completed_at: '2026-11-01T00:00:00Z', ins_date_cursor: '2026-11-17T06:00:00Z' },
    ]);
    const navRow = (id: string, number: string, net: number, vat: number, issue: string) => ({
      id, organization_slug: ORG, company_id: 'co-1', connection_id: 'conn-test', customer_tax_number: BUYER, supplier_tax_number: SUP,
      supplier_name: 'Példa Kft', invoice_number: number, invoice_operation: 'CREATE', currency: 'HUF', net_amount: net, vat_amount: vat,
      gross_amount: net + vat, invoice_issue_date: issue, transaction_id: `TX-${id}`, ins_date: `${issue}T09:00:00Z`, detail_status: 'detail_fetched',
      vat_breakdown: [{ vatRate: { kind: 'percentage', rate: 27 }, net, vat }], supplier_address: '1051 Budapest, Fő utca 1.',
    });
    db.seed('pi_nav_invoices', [navRow('nav-a', 'SZ-1', 100000, 27000, '2026-10-01'), navRow('nav-b', 'SZ-2', 1000, 270, '2026-10-02')]);
    db.seed('purchase_invoices', [{
      id: 'doc-a', organization_slug: ORG, buyer_company_id: 'co-1', buyer_tax_id: BUYER, merchant_tax_id: SUP, merchant_name: 'Példa Kft',
      merchant_address: null, invoice_number: 'SZ-1', document_kind: 'normal_invoice', currency: 'HUF', currency_source: 'document',
      total_amount: 127000, net_amount: 100000, total_vat_amount: 27000, invoice_date: '2026-10-01', status: 'processed',
      approval_status: 'none', is_verified: true, created_at: '2026-10-02T10:00:00Z',
    }]);
  });

  it('reconciles an organization and sends gap-fill provenance for matched pairs', async () => {
    const out = await reconcileOrganization(db, ORG, { today: '2026-11-17' });
    expect(out).toMatchObject({ documents: 1, navInvoices: 2 });
    const docPayload = applied._documents.find((d: any) => d.id === 'doc-a');
    expect(docPayload).toMatchObject({ status: 'exact_match', nav_invoice_id: 'nav-a', company_id: 'co-1' });
    expect(applied._nav.find((n: any) => n.id === 'nav-b')).toMatchObject({ status: 'nav_only', document_id: null });
    const item = gapItems.find((g) => g.invoice_id === 'doc-a');
    expect(item.fills).toMatchObject({ merchant_address: '1051 Budapest, Fő utca 1.' });
    expect(item.vat_lines).toHaveLength(1);
    expect(item.provenance.find((p: any) => p.field === 'total_amount')).toMatchObject({ action: 'equivalent' });
  });

  it('ignores NAV data from connections not marked for reconciliation', async () => {
    db.table('pi_nav_connections')[0].use_for_reconciliation = false;
    const out = await reconcileOrganization(db, ORG, { today: '2026-11-17' });
    expect(out.navInvoices).toBe(0);
    expect(applied._documents[0].status).not.toBe('exact_match');
  });

  it('serializes runs and coalesces a request that arrived during a run', async () => {
    let locked = false;
    let pending = 0;
    db.rpcs.set('pi_claim_reconcile', () => { if (locked) { pending++; return false; } locked = true; return true; });
    db.rpcs.set('pi_release_reconcile', () => { locked = false; const p = pending > 0; pending = 0; return p; });
    const original = db.rpcs.get('pi_apply_reconciliation')!;
    let nested: Promise<any> | null = null;
    db.rpcs.set('pi_apply_reconciliation', (a, d) => {
      if (!nested) nested = runReconciliation(d, ORG, { today: '2026-11-17' }); // arrives mid-run
      return original(a, d);
    });
    const result = await runReconciliation(db, ORG, { today: '2026-11-17' });
    const concurrent = await nested!;
    expect(concurrent.status).toBe('busy');
    expect(result).toMatchObject({ status: 'completed', runs: 2 });
  });
});
