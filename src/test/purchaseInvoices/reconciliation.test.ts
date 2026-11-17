import { describe, expect, it } from 'vitest';
import {
  reconcile, type ReconCompany, type ReconDocument, type ReconNavInvoice,
} from '../../../supabase/functions/_shared/purchaseInvoices/reconciliation';
import { planGapFill } from '../../../supabase/functions/_shared/purchaseInvoices/gapFill';
import { approvalBlockers } from '../../../supabase/functions/_shared/purchaseInvoices/approvalGate';
import { validTaxCore } from './navFixtures';

const TODAY = '2026-11-17';
const RD = validTaxCore('1234567');      // RD Hotel Kft (buyer)
const GOZSDU = validTaxCore('2345678');  // second legal company
const SUP_A = validTaxCore('2400000');
const SUP_B = validTaxCore('2400001');

const companies: ReconCompany[] = [
  { id: 'co-rd', taxNumber: `${RD}-2-42`, navCoverageFrom: '2026-01-01', navSyncedThrough: '2026-11-17T06:00:00.000Z' },
  { id: 'co-gozsdu', taxNumber: GOZSDU, navCoverageFrom: '2026-01-01', navSyncedThrough: '2026-11-17T06:00:00.000Z' },
];

let seq = 0;
function doc(p: Partial<ReconDocument> = {}): ReconDocument {
  seq++;
  return {
    id: p.id ?? `doc-${String(seq).padStart(3, '0')}`,
    companyId: 'co-rd', buyerTaxNumber: RD, supplierTaxNumber: SUP_A, supplierCountry: 'HU',
    supplierName: 'Példa Beszállító Kft.', invoiceNumber: 'SZ-2026/0042', documentKind: 'normal_invoice',
    currency: 'HUF', grossAmount: 127000, netAmount: 100000, vatAmount: 27000, issueDate: '2026-10-15',
    status: 'processed', createdAt: `2026-10-20T10:00:${String(seq % 60).padStart(2, '0')}.000Z`, ...p,
  };
}
function nav(p: Partial<ReconNavInvoice> = {}): ReconNavInvoice {
  seq++;
  return {
    id: p.id ?? `nav-${String(seq).padStart(3, '0')}`,
    companyId: 'co-rd', customerTaxNumber: RD, supplierTaxNumber: SUP_A, supplierName: 'PÉLDA BESZÁLLÍTÓ KFT',
    invoiceNumber: 'SZ-2026/0042', operation: 'CREATE', originalInvoiceNumber: null, currency: 'HUF',
    grossAmount: 127000, netAmount: 100000, vatAmount: 27000, issueDate: '2026-10-15', transactionId: `TX${seq}`,
    insDate: '2026-10-15T09:00:00.000Z', ...p,
  };
}
const run = (documents: ReconDocument[], navInvoices: ReconNavInvoice[], extra: Partial<Parameters<typeof reconcile>[0]> = {}) =>
  reconcile({ companies, documents, navInvoices, today: TODAY, ...extra });
const docStatus = (out: ReturnType<typeof reconcile>, id: string) => out.documents.find((d) => d.documentId === id);
const navStatus = (out: ReturnType<typeof reconcile>, id: string) => out.navInvoices.find((n) => n.navInvoiceId === id);

describe('reconciliation hierarchy', () => {
  it('produces an explainable exact match', () => {
    const out = run([doc({ id: 'd1' })], [nav({ id: 'n1' })]);
    const d = docStatus(out, 'd1')!;
    expect(d).toMatchObject({ status: 'exact_match', navInvoiceId: 'n1', score: 1 });
    expect(d.explanation.map((s) => s.rule)).toEqual(expect.arrayContaining(['buyer_company', 'supplier_tax', 'invoice_number', 'invoice_type', 'currency', 'gross_amount', 'net_amount', 'total_vat_amount', 'issue_date', 'supplier_name']));
    expect(navStatus(out, 'n1')).toMatchObject({ status: 'exact_match', documentId: 'd1' });
  });

  it('tolerates OCR separator differences in invoice numbers', () => {
    const out = run([doc({ id: 'd1', invoiceNumber: 'SZ 2026 0042' })], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd1')?.status).toBe('exact_match');
  });

  it('flags a data mismatch instead of overwriting either source', () => {
    const out = run([doc({ id: 'd1', grossAmount: 172000, vatAmount: 72000 })], [nav({ id: 'n1' })]);
    const d = docStatus(out, 'd1')!;
    expect(d.status).toBe('data_mismatch');
    expect(d.differences).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'total_amount', document: 172000, nav: 127000, material: true })]));
    expect(navStatus(out, 'n1')?.status).toBe('data_mismatch');
  });

  it('downgrades to probable when the issue date is far off', () => {
    const out = run([doc({ id: 'd1', issueDate: '2026-09-01' })], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd1')?.status).toBe('probable_match');
  });

  it('never matches on supplier name and amount alone', () => {
    const out = run([doc({ id: 'd1', supplierTaxNumber: null, invoiceNumber: null })], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd1')?.status).toBe('document_only');
    expect(navStatus(out, 'n1')?.status).toBe('nav_only');
  });

  it('never matches across legal companies', () => {
    const out = run(
      [doc({ id: 'd1', companyId: 'co-gozsdu', buyerTaxNumber: GOZSDU })],
      [nav({ id: 'n1', companyId: 'co-rd', customerTaxNumber: RD })],
    );
    expect(docStatus(out, 'd1')?.status).toBe('document_only');
    expect(navStatus(out, 'n1')?.status).toBe('nav_only');
  });

  it('uses the buyer named on the invoice over a property-based assignment', () => {
    const out = run([doc({ id: 'd1', companyId: 'co-gozsdu', buyerTaxNumber: RD })], [nav({ id: 'n1' })]);
    const d = docStatus(out, 'd1')!;
    expect(d.status).toBe('exact_match');
    expect(d.companyId).toBe('co-rd');
    expect(d.explanation.some((s) => s.rule === 'buyer_company_assignment' && s.result === 'fail')).toBe(true);
  });

  it('flags duplicate uploads and keeps the matching copy as primary', () => {
    const out = run([
      doc({ id: 'd1', grossAmount: 172000, createdAt: '2026-10-16T10:00:00.000Z' }),
      doc({ id: 'd2', createdAt: '2026-10-17T10:00:00.000Z' }),
    ], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd2')?.status).toBe('exact_match');
    expect(docStatus(out, 'd1')).toMatchObject({ status: 'duplicate_document', duplicateOfDocumentId: 'd2' });
    expect(navStatus(out, 'n1')).toMatchObject({ status: 'exact_match', documentId: 'd2', duplicateDocumentIds: ['d1'] });
  });

  it('flags duplicate uploads even before NAV has the invoice', () => {
    const out = run([doc({ id: 'd1', issueDate: '2026-11-16' }), doc({ id: 'd2', issueDate: '2026-11-16' })], []);
    expect(docStatus(out, 'd1')?.status).toBe('nav_sync_pending');
    expect(docStatus(out, 'd2')).toMatchObject({ status: 'duplicate_document', duplicateOfDocumentId: 'd1' });
  });

  it('flags identical files as duplicates', () => {
    const out = run([doc({ id: 'd1', invoiceNumber: null, fileSha256: 'abc' }), doc({ id: 'd2', invoiceNumber: null, fileSha256: 'abc' })], []);
    expect(docStatus(out, 'd2')?.status).toBe('duplicate_document');
  });

  it('detects competing NAV data reports for the same invoice', () => {
    const out = run([doc({ id: 'd1' })], [nav({ id: 'n1', transactionId: 'T1' }), nav({ id: 'n2', transactionId: 'T2', insDate: '2026-10-16T09:00:00.000Z' })]);
    expect(docStatus(out, 'd1')).toMatchObject({ status: 'competing_nav_candidates', candidateNavIds: ['n1', 'n2'] });
    expect(navStatus(out, 'n1')?.status).toBe('competing_nav_candidates');
    expect(navStatus(out, 'n2')?.status).toBe('competing_nav_candidates');
  });

  it('handles storno chains: the cancelled base invoice and the missing storno document', () => {
    const out = run([doc({ id: 'd1' })], [
      nav({ id: 'n1' }),
      nav({ id: 'n2', invoiceNumber: 'SZ-2026/0099', operation: 'STORNO', originalInvoiceNumber: 'SZ-2026/0042', grossAmount: -127000, netAmount: -100000, vatAmount: -27000 }),
    ]);
    expect(docStatus(out, 'd1')?.status).toBe('correction_chain');
    expect(navStatus(out, 'n2')).toMatchObject({ status: 'nav_only' });
    expect(navStatus(out, 'n2')?.explanation[0].detail).toContain('STORNO of SZ-2026/0042');
  });

  it('matches a credit-note document to its STORNO record with sign normalization', () => {
    const out = run([doc({ id: 'd1', documentKind: 'credit_note', invoiceNumber: 'SZ-2026/0099', referenceInvoiceNumber: 'SZ-2026/0042', grossAmount: 127000, netAmount: 100000, vatAmount: 27000 })], [
      nav({ id: 'n2', invoiceNumber: 'SZ-2026/0099', operation: 'STORNO', originalInvoiceNumber: 'SZ-2026/0042', grossAmount: -127000, netAmount: -100000, vatAmount: -27000 }),
    ]);
    expect(docStatus(out, 'd1')?.status).toBe('exact_match');
  });

  it('does not expect receipts, pro formas or foreign suppliers in NAV', () => {
    const out = run([
      doc({ id: 'd1', documentKind: 'receipt' }),
      doc({ id: 'd2', documentKind: 'proforma' }),
      doc({ id: 'd3', supplierTaxNumber: 'ATU12345678', supplierCountry: 'AT', invoiceNumber: 'AT-1' }),
    ], []);
    expect(out.documents.map((d) => [d.documentId, d.status, d.reason])).toEqual([
      ['d1', 'not_expected', 'receipt_not_reported'],
      ['d2', 'not_expected', 'proforma_not_invoice'],
      ['d3', 'not_expected', 'foreign_supplier'],
    ]);
  });

  it('waits for the reporting window and sync coverage before concluding NAV has nothing', () => {
    const recent = run([doc({ id: 'd1', issueDate: '2026-11-14' })], []);
    expect(docStatus(recent, 'd1')).toMatchObject({ status: 'nav_sync_pending' });
    const incomplete = reconcile({ companies: [{ ...companies[0], navCoverageFrom: '2026-11-01' }], documents: [doc({ id: 'd2', issueDate: '2026-10-01' })], navInvoices: [], today: TODAY });
    expect(docStatus(incomplete, 'd2')).toMatchObject({ status: 'nav_sync_pending' });
    const old = run([doc({ id: 'd3', issueDate: '2026-10-01' })], []);
    expect(docStatus(old, 'd3')).toMatchObject({ status: 'document_only' });
    const neverSynced = reconcile({ companies: [{ ...companies[0], navCoverageFrom: null, navSyncedThrough: null }], documents: [doc({ id: 'd4' })], navInvoices: [], today: TODAY });
    expect(docStatus(neverSynced, 'd4')?.status).toBe('not_checked');
  });

  it('matches late-arriving NAV records on the next run', () => {
    const first = run([doc({ id: 'd1', issueDate: '2026-11-15' })], []);
    expect(docStatus(first, 'd1')?.status).toBe('nav_sync_pending');
    const second = run([doc({ id: 'd1', issueDate: '2026-11-15' })], [nav({ id: 'n1', issueDate: '2026-11-15', insDate: '2026-11-16T20:00:00.000Z' })]);
    expect(docStatus(second, 'd1')?.status).toBe('exact_match');
  });

  it('matches OCR-misread invoice numbers only as probable', () => {
    const out = run([doc({ id: 'd1', invoiceNumber: 'SZ-2026/0O42' })], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd1')).toMatchObject({ status: 'probable_match', navInvoiceId: 'n1' });
  });

  it('matches a document without invoice number on supplier tax + amount + date as probable', () => {
    const out = run([doc({ id: 'd1', invoiceNumber: null })], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd1')?.status).toBe('probable_match');
    const ambiguous = run([doc({ id: 'd2', invoiceNumber: null })], [nav({ id: 'n2' }), nav({ id: 'n3', invoiceNumber: 'SZ-2026/0043' })]);
    expect(docStatus(ambiguous, 'd2')?.status).toBe('document_only');
  });

  it('identifies an unknown buyer only from an exact supplier invoice, as probable', () => {
    const out = run([doc({ id: 'd1', companyId: null, buyerTaxNumber: null })], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd1')).toMatchObject({ status: 'probable_match', companyId: 'co-rd' });
  });

  it('respects manual resolutions', () => {
    const out = run([doc({ id: 'd1', invoiceNumber: 'X-1', manual: { status: 'matched', navInvoiceId: 'n1', reason: 'Verified by phone' } })], [nav({ id: 'n1' })]);
    expect(docStatus(out, 'd1')).toMatchObject({ status: 'manual_resolution', navInvoiceId: 'n1' });
    expect(navStatus(out, 'n1')?.status).toBe('manual_resolution');
  });

  it('never matches a NAV record whose customer is another company', () => {
    const out = run([doc({ id: 'd1' })], [nav({ id: 'n1', customerTaxNumber: GOZSDU })]);
    expect(navStatus(out, 'n1')).toMatchObject({ status: 'not_expected', reason: 'customer_tax_mismatch' });
    expect(docStatus(out, 'd1')?.status).toBe('document_only');
  });

  it('ignores documents still being processed and is deterministic', () => {
    const docs = [doc({ id: 'd1' }), doc({ id: 'd2', status: 'processing', invoiceNumber: 'P-1' })];
    const navs = [nav({ id: 'n1' })];
    const a = run(docs, navs);
    const b = run([...docs].reverse(), [...navs].reverse());
    expect(a).toEqual(b);
    expect(docStatus(a, 'd2')).toBeUndefined();
  });

  it('computes days outstanding for NAV-only invoices', () => {
    const out = run([], [nav({ id: 'n1', issueDate: '2026-11-07' })]);
    expect(navStatus(out, 'n1')).toMatchObject({ status: 'nav_only', daysOutstanding: 10 });
  });

  it('does not report pre-go-live NAV invoices as missing documents, but still matches them', () => {
    const settings = { reconciliationStartDate: '2026-10-01' };
    const out = run(
      [doc({ id: 'd-old', invoiceNumber: 'OLD-1', issueDate: '2026-09-10' })],
      [
        nav({ id: 'n-old-unmatched', invoiceNumber: 'OLD-0', issueDate: '2026-09-05' }),
        nav({ id: 'n-old-matched', invoiceNumber: 'OLD-1', issueDate: '2026-09-10' }),
        nav({ id: 'n-new', invoiceNumber: 'NEW-1', issueDate: '2026-10-02' }),
      ],
      { settings },
    );
    expect(navStatus(out, 'n-old-unmatched')).toMatchObject({ status: 'not_expected', reason: 'before_reconciliation_start' });
    expect(navStatus(out, 'n-old-matched')).toMatchObject({ status: 'exact_match', documentId: 'd-old' });
    expect(navStatus(out, 'n-new')).toMatchObject({ status: 'nav_only' });
  });

  it('flags a foreign-currency amount difference', () => {
    const out = run([doc({ id: 'd1', currency: 'EUR', grossAmount: 119, netAmount: 100, vatAmount: 19 })], [nav({ id: 'n1', currency: 'EUR', grossAmount: 119.5, netAmount: 100.5, vatAmount: 19 })]);
    expect(docStatus(out, 'd1')?.status).toBe('data_mismatch');
  });
});

describe('gap filling with field provenance', () => {
  const navDetail = {
    companyId: 'co-rd', supplierTaxNumber: '10773381-2-44', supplierName: 'Példa Beszállító Kft.', supplierAddress: '1051 Budapest, Fő utca 1.',
    supplierBankAccount: '11111111-22222222-33333333', customerTaxNumber: `${RD}-2-42`, customerName: 'RD Hotel Kft.', invoiceNumber: 'SZ-2026/0042',
    issueDate: '2026-10-15', deliveryDate: '2026-10-14', paymentDate: '2026-10-30', paymentMethod: 'TRANSFER', currency: 'HUF',
    netAmount: 100000, vatAmount: 27000, grossAmount: 127000,
    vatSummary: [{ vatRate: { kind: 'percentage', rate: 27, case: null, reason: null }, net: 100000, vat: 27000 }],
  };
  const docValues = {
    merchant_name: 'Példa Beszállító Kft.', merchant_tax_id: null, merchant_address: null, merchant_bank_account: null,
    buyer_name: 'RD Hotel Kft.', buyer_tax_id: RD, buyer_company_id: null, invoice_number: 'SZ-2026/0042', invoice_date: '2026-10-15',
    performance_date: null, due_date: null, payment_method: null, currency: 'HUF', currency_detected: true,
    net_amount: 100000, total_vat_amount: null, total_amount: 127000, vat_line_count: 0,
  };

  it('fills only empty fields on a verified match and keeps provenance', () => {
    const plan = planGapFill(docValues, navDetail, 'exact_match');
    expect(plan.fills).toEqual({
      merchant_tax_id: '10773381-2-44', merchant_address: '1051 Budapest, Fő utca 1.', merchant_bank_account: '11111111-22222222-33333333',
      buyer_company_id: 'co-rd', performance_date: '2026-10-14', due_date: '2026-10-30', payment_method: 'bank_transfer', total_vat_amount: 27000,
    });
    expect(plan.vatLines).toEqual([{ vat_kind: 'standard_27', vat_rate: 27, vat_base: 100000, vat_amount: 27000, source: 'nav' }]);
    expect(plan.fields.find((f) => f.field === 'total_amount')?.action).toBe('equivalent');
    expect(plan.materialConflicts).toBe(0);
  });

  it('only proposes values on a probable match', () => {
    const plan = planGapFill(docValues, navDetail, 'probable_match');
    expect(plan.fills).toEqual({});
    expect(plan.vatLines).toBeNull();
    expect(plan.proposedVatLines).toHaveLength(1);
    expect(plan.fields.filter((f) => f.action === 'propose').map((f) => f.field)).toContain('merchant_tax_id');
  });

  it('flags conflicts and never overwrites document values', () => {
    const plan = planGapFill({ ...docValues, total_amount: 172000, invoice_date: '2026-10-16' }, navDetail, 'exact_match');
    expect(plan.fills.total_amount).toBeUndefined();
    expect(plan.fields.find((f) => f.field === 'total_amount')).toMatchObject({ action: 'conflict', documentValue: 172000, navValue: 127000, finalValue: 172000 });
    expect(plan.materialConflicts).toBe(2);
  });

  it('treats an undetected (defaulted) currency as missing and does nothing for unmatched pairs', () => {
    expect(planGapFill({ ...docValues, currency: 'HUF', currency_detected: false }, { ...navDetail, currency: 'EUR' }, 'exact_match').fills.currency).toBe('EUR');
    expect(planGapFill(docValues, navDetail, 'data_mismatch').fields).toEqual([]);
  });
});

describe('approval gate', () => {
  const base = { id: 'i1', approval_status: 'none', review_status: 'pending_approval', nav_match_status: 'exact_match', duplicate_status: 'none', validation_status: 'ok', open_conflicts: 0, uploaded_by: 'u1', reviewed_by: 'u2' };
  const ctx = { approverId: 'u3', canApprove: true, inScope: true, requireSeparateApprover: true, blockOnExceptions: true, requireNavMatch: false };

  it('allows a clean, submitted invoice', () => {
    expect(approvalBlockers(base, ctx)).toEqual([]);
  });
  it('blocks exceptions, duplicates, conflicts, validation errors and self-approval', () => {
    expect(approvalBlockers({ ...base, nav_match_status: 'data_mismatch' }, ctx)).toContain('nav_exception');
    expect(approvalBlockers({ ...base, nav_match_status: 'duplicate_document' }, ctx)).toContain('nav_exception');
    expect(approvalBlockers({ ...base, duplicate_status: 'suspected' }, ctx)).toContain('duplicate_suspected');
    expect(approvalBlockers({ ...base, open_conflicts: 1 }, ctx)).toContain('open_conflicts');
    expect(approvalBlockers({ ...base, validation_status: 'error' }, ctx)).toContain('validation_errors');
    expect(approvalBlockers(base, { ...ctx, approverId: 'u1' })).toContain('self_approval');
    expect(approvalBlockers({ ...base, approval_status: 'approved' }, ctx)).toContain('already_approved');
    expect(approvalBlockers(base, { ...ctx, canApprove: false, inScope: false })).toEqual(expect.arrayContaining(['not_controller', 'out_of_scope']));
    expect(approvalBlockers({ ...base, nav_match_status: 'nav_sync_pending' }, { ...ctx, requireNavMatch: true })).toContain('nav_match_required');
  });
});
