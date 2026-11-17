/**
 * Acceptance test from the HotelCare Purchase Invoice specification:
 *
 *   Given a NAV test dataset with 20 incoming invoices, 17 uploaded matching
 *   documents, one incorrect amount and one duplicate upload, HotelCare must
 *   identify the three NAV-only documents, the incorrect amount and the
 *   duplicate, without falsely approving any unresolved exception.
 *
 * The NAV side is parsed from synthetic digest XML (official v3.0 shape) so
 * the whole path — NAV response → normalized record → reconciliation →
 * approval gate — is exercised.
 */
import { describe, expect, it } from 'vitest';
import { parseInvoiceDigestResponse, navSourceKey } from '../../../supabase/functions/_shared/purchaseInvoices/navResponse';
import { reconcile, type ReconDocument, type ReconNavInvoice } from '../../../supabase/functions/_shared/purchaseInvoices/reconciliation';
import { approvalBlockers } from '../../../supabase/functions/_shared/purchaseInvoices/approvalGate';
import { digestResponseXml, validTaxCore, type DigestFixture } from './navFixtures';

const BUYER = validTaxCore('1234567');

describe('acceptance: 20 NAV invoices, 17 documents, 1 wrong amount, 1 duplicate', () => {
  const fixtures: DigestFixture[] = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    const net = 10000 * n;
    return {
      invoiceNumber: `INV-2026/${String(n).padStart(4, '0')}`,
      supplierTaxNumber: validTaxCore(String(2400000 + (n % 7))),
      supplierName: `Beszállító ${n % 7} Kft.`,
      customerTaxNumber: BUYER,
      invoiceIssueDate: `2026-10-${String(n).padStart(2, '0')}`,
      invoiceNetAmount: net,
      invoiceVatAmount: Math.round(net * 0.27),
      insDate: `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`,
      transactionId: `TXACC${n}`,
    };
  });
  // NAV returns 100 items per page; split across two pages to exercise paging.
  const pages = [parseInvoiceDigestResponse(digestResponseXml(fixtures.slice(0, 12), 1, 2)), parseInvoiceDigestResponse(digestResponseXml(fixtures.slice(12), 2, 2))];
  const digests = pages.flatMap((p) => p.digests);

  const navInvoices: ReconNavInvoice[] = digests.map((d) => ({
    id: `nav-${d.invoiceNumber}`,
    companyId: 'co-rd',
    customerTaxNumber: d.customerTaxNumber,
    supplierTaxNumber: d.supplierTaxNumber,
    supplierName: d.supplierName,
    invoiceNumber: d.invoiceNumber,
    operation: d.invoiceOperation,
    originalInvoiceNumber: d.originalInvoiceNumber,
    currency: d.currency,
    grossAmount: d.grossAmount,
    netAmount: d.invoiceNetAmount,
    vatAmount: d.invoiceVatAmount,
    issueDate: d.invoiceIssueDate,
    transactionId: d.transactionId,
    insDate: d.insDate,
  }));

  // 17 uploaded documents for NAV invoices 1..17. Invoice 9 was entered with a
  // wrong total. Invoice 4 was uploaded twice (the 18th document).
  const documents: ReconDocument[] = fixtures.slice(0, 17).map((f, i) => {
    const gross = (f.invoiceNetAmount ?? 0) + (f.invoiceVatAmount ?? 0);
    const wrong = i + 1 === 9;
    return {
      id: `doc-${String(i + 1).padStart(2, '0')}`,
      companyId: 'co-rd',
      buyerTaxNumber: `${BUYER}-2-42`,
      supplierTaxNumber: `${f.supplierTaxNumber}-2-41`,
      supplierCountry: 'HU',
      supplierName: f.supplierName ?? null,
      invoiceNumber: f.invoiceNumber.toLowerCase(),
      documentKind: 'normal_invoice',
      currency: 'HUF',
      grossAmount: wrong ? gross + 9000 : gross,
      netAmount: f.invoiceNetAmount ?? null,
      vatAmount: wrong ? (f.invoiceVatAmount ?? 0) + 9000 : f.invoiceVatAmount ?? null,
      issueDate: f.invoiceIssueDate ?? null,
      status: 'processed',
      createdAt: `2026-10-25T08:${String(i).padStart(2, '0')}:00.000Z`,
    };
  });
  documents.push({ ...documents[3], id: 'doc-18-duplicate', createdAt: '2026-10-26T08:00:00.000Z' });

  const out = reconcile({
    companies: [{ id: 'co-rd', taxNumber: BUYER, navCoverageFrom: '2026-01-01', navSyncedThrough: '2026-11-17T06:00:00.000Z' }],
    documents,
    navInvoices,
    today: '2026-11-17',
  });

  it('parses all 20 NAV invoices with distinct identities', () => {
    expect(digests).toHaveLength(20);
    expect(new Set(digests.map(navSourceKey)).size).toBe(20);
  });

  it('identifies exactly the three NAV-only invoices', () => {
    const navOnly = out.navInvoices.filter((n) => n.status === 'nav_only').map((n) => n.navInvoiceId).sort();
    expect(navOnly).toEqual(['nav-INV-2026/0018', 'nav-INV-2026/0019', 'nav-INV-2026/0020']);
  });

  it('identifies the incorrect amount', () => {
    const mismatches = out.documents.filter((d) => d.status === 'data_mismatch');
    expect(mismatches.map((d) => d.documentId)).toEqual(['doc-09']);
    expect(mismatches[0].differences.find((x) => x.field === 'total_amount')).toMatchObject({ delta: 9000, material: true });
  });

  it('identifies the duplicate upload', () => {
    const duplicates = out.documents.filter((d) => d.status === 'duplicate_document');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ documentId: 'doc-18-duplicate', duplicateOfDocumentId: 'doc-04' });
  });

  it('matches the remaining 16 documents exactly', () => {
    expect(out.documents.filter((d) => d.status === 'exact_match')).toHaveLength(16);
    expect(out.summary).toMatchObject({ document_exact_match: 16, document_data_mismatch: 1, document_duplicate_document: 1, nav_nav_only: 3, nav_exact_match: 16, nav_data_mismatch: 1 });
  });

  it('never approves an unresolved exception', () => {
    const ctx = { approverId: 'controller-1', canApprove: true, inScope: true, requireSeparateApprover: false, blockOnExceptions: true, requireNavMatch: false };
    const approvable = out.documents.filter((d) => approvalBlockers({
      id: d.documentId, approval_status: 'none', review_status: 'pending_approval', nav_match_status: d.status,
      duplicate_status: 'none', validation_status: 'ok', open_conflicts: 0, uploaded_by: 'reception-1', reviewed_by: 'backoffice-1',
    }, ctx).length === 0);
    expect(approvable).toHaveLength(16);
    expect(approvable.map((d) => d.documentId)).not.toContain('doc-09');
    expect(approvable.map((d) => d.documentId)).not.toContain('doc-18-duplicate');
  });
});
