import { describe, expect, it } from 'vitest';
import {
  needsSecondPass, normalizeDocumentKind, validateExtractedInvoice,
} from '../../../supabase/functions/_shared/purchaseInvoices/invoiceValidation';
import {
  invoiceNumberLoose, isValidHuTaxCore, parseMoney, taxCore8, normalizeDate, companyNameSimilarity,
} from '../../../supabase/functions/_shared/purchaseInvoices/normalize';

const TODAY = '2026-11-17';
const check = (r: ReturnType<typeof validateExtractedInvoice>, id: string) => r.checks.find((c) => c.id === id);

describe('Hungarian number, date and tax-number normalization', () => {
  it.each([
    ['1 234 567,89', 1234567.89],
    ['1.234.567,89 Ft', 1234567.89],
    ['1,234,567.89', 1234567.89],
    ['12 500 Ft', 12500],
    ['-12 500', -12500],
    ['(1 000)', -1000],
    ['127.000', 127000],
    ['12,5', 12.5],
    ['EUR 1,250.40', 1250.4],
    [42, 42],
  ])('parses %s', (input, expected) => {
    expect(parseMoney(input)).toBeCloseTo(expected as number, 2);
  });

  it('rejects text that is not money', () => {
    expect(parseMoney('n/a')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });

  it('normalizes dates and rejects impossible ones', () => {
    expect(normalizeDate('2026.11.03.')).toBe('2026-11-03');
    expect(normalizeDate('2026. 11. 3.')).toBe('2026-11-03');
    expect(normalizeDate('03/11/2026')).toBe('2026-11-03');
    expect(normalizeDate('2026-02-30')).toBeNull();
  });

  it('extracts 8-digit tax cores and validates the check digit', () => {
    expect(taxCore8('10773381-2-44')).toBe('10773381');
    expect(taxCore8('HU10773381')).toBe('10773381');
    expect(taxCore8('ATU12345678')).toBeNull();
    expect(isValidHuTaxCore('10773381')).toBe(true);
    expect(isValidHuTaxCore('10773382')).toBe(false);
    expect(invoiceNumberLoose('sz-2026 / 0042')).toBe('SZ20260042');
    expect(companyNameSimilarity('Példa Beszállító Kft.', 'PELDA BESZALLITO KORLATOLT FELELOSSEGU TARSASAG')).toBeGreaterThan(0.6);
  });

  it('maps Hungarian document type names', () => {
    expect(normalizeDocumentKind('díjbekérő')).toBe('proforma');
    expect(normalizeDocumentKind('sztornó')).toBe('cancellation');
    expect(normalizeDocumentKind(null, 'receipt')).toBe('receipt');
    expect(normalizeDocumentKind('elolegszamla')).toBe('advance_invoice');
  });
});

describe('deterministic invoice checks', () => {
  it('accepts a consistent 27% invoice', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', net_amount: 100000, total_vat_amount: 27000, total_amount: 127000, vat_lines: [{ vat_kind: 'standard_27', vat_rate: 27, vat_base: 100000, vat_amount: 27000 }], invoice_date: '2026-11-03', merchant_tax_id: '10773381-2-44' }, { today: TODAY });
    expect(r.status).toBe('ok');
    expect(check(r, 'net_vat_gross')?.status).toBe('pass');
    expect(check(r, 'vat_breakdown_totals')?.status).toBe('pass');
  });

  it('accepts mixed 27% / 18% / 5% VAT and records it', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', net_amount: 300000, total_vat_amount: 50000, total_amount: 350000, vat_lines: [
      { vat_rate: 27, vat_base: 100000, vat_amount: 27000 },
      { vat_rate: 18, vat_base: 100000, vat_amount: 18000 },
      { vat_rate: 5, vat_base: 100000, vat_amount: 5000 },
    ], invoice_date: '2026-11-03' }, { today: TODAY });
    expect(check(r, 'mixed_vat')?.status).toBe('pass');
    expect(r.status).toBe('ok');
    expect(r.normalized.vat_lines.map((l) => l.vat_kind)).toEqual(['standard_27', 'reduced_18', 'reduced_5']);
  });

  it('accepts exempt and reverse-charge lines without VAT and rejects VAT on them', () => {
    const ok = validateExtractedInvoice({ currency: 'HUF', net_amount: 15000, total_vat_amount: 0, total_amount: 15000, vat_lines: [
      { vat_kind: 'aam_exempt', vat_rate: 0, vat_base: 5000, vat_amount: 0 },
      { vat_kind: 'kba_reverse', vat_rate: 0, vat_base: 10000, vat_amount: 0 },
    ], invoice_date: '2026-11-03' }, { today: TODAY });
    expect(ok.status).toBe('ok');
    const bad = validateExtractedInvoice({ currency: 'HUF', net_amount: 10000, total_vat_amount: 2700, total_amount: 12700, vat_lines: [{ vat_kind: 'kba_reverse', vat_rate: 0, vat_base: 10000, vat_amount: 2700 }], invoice_date: '2026-11-03' }, { today: TODAY });
    expect(check(bad, 'vat_line_exempt')?.status).toBe('fail');
  });

  it('flags net + VAT ≠ gross', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', net_amount: 100000, total_vat_amount: 27000, total_amount: 172000, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(check(r, 'net_vat_gross')).toMatchObject({ status: 'fail', detail: { delta: -45000 } });
    expect(r.status).toBe('error');
    expect(needsSecondPass(r, 0.9)).toBe(true);
  });

  it('never invents a 27% breakdown when only the gross total is known', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', total_amount: 12700, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(r.normalized.vat_lines).toEqual([]);
    expect(r.normalized.total_vat_amount).toBeNull();
    expect(check(r, 'vat_breakdown_totals')?.status).toBe('warn');
    expect(r.needsReview).toBe(true);
  });

  it('derives a single standard rate only from printed net and VAT totals', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', net_amount: 10000, total_vat_amount: 1800, total_amount: 11800, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(r.normalized.vat_lines).toEqual([{ vat_kind: 'reduced_18', vat_rate: 18, vat_base: 10000, vat_amount: 1800, country: null, source: 'derived_from_totals' }]);
    const mixed = validateExtractedInvoice({ currency: 'HUF', net_amount: 200000, total_vat_amount: 32000, total_amount: 232000, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(mixed.normalized.vat_lines).toEqual([]);
  });

  it('keeps the invoice total separate from an amount due that includes a previous balance', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', net_amount: 100000, total_vat_amount: 27000, total_amount: 127000, amount_due: 177000, previous_balance: 50000, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(check(r, 'amount_due')?.status).toBe('pass');
    expect(r.normalized.total_amount).toBe(127000);
    expect(r.normalized.amount_due).toBe(177000);
    const unexplained = validateExtractedInvoice({ currency: 'HUF', net_amount: 100000, total_vat_amount: 27000, total_amount: 127000, amount_due: 99000, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(check(unexplained, 'amount_due')?.status).toBe('warn');
    expect(unexplained.normalized.total_amount).toBe(127000);
  });

  it('normalizes credit-note signs and rejects inconsistent signs', () => {
    const r = validateExtractedInvoice({ document_kind: 'credit_note', currency: 'HUF', net_amount: 10000, total_vat_amount: 2700, total_amount: 12700, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(r.normalized).toMatchObject({ net_amount: -10000, total_vat_amount: -2700, total_amount: -12700, is_credit_note: true });
    const mixed = validateExtractedInvoice({ document_kind: 'cancellation', currency: 'HUF', net_amount: -10000, total_vat_amount: 2700, total_amount: -7300, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(check(mixed, 'credit_sign')?.status).toBe('fail');
  });

  it('handles foreign currency and foreign suppliers', () => {
    const r = validateExtractedInvoice({ currency: 'EUR', net_amount: 100, total_vat_amount: 19, total_amount: 119, merchant_tax_id: 'DE123456789', merchant_country: 'DE', invoice_date: '2026-11-03' }, { today: TODAY });
    expect(r.normalized.currency).toBe('EUR');
    expect(r.normalized.merchant_is_foreign).toBe(true);
    expect(check(r, 'net_vat_gross')?.status).toBe('pass');
  });

  it('does not assume a currency that was not on the document', () => {
    const r = validateExtractedInvoice({ net_amount: 100, total_vat_amount: 27, total_amount: 127, invoice_date: '2026-11-03' }, { today: TODAY });
    expect(r.normalized.currency).toBeNull();
    expect(r.normalized.currency_detected).toBe(false);
    expect(r.needsReview).toBe(true);
  });

  it('checks dates and tax-number check digits', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', total_amount: 1000, net_amount: 787.4, total_vat_amount: 212.6, invoice_date: '2026-12-31', due_date: '2026-12-01', merchant_tax_id: '10773382-2-44' }, { today: TODAY });
    expect(check(r, 'issue_date')?.status).toBe('fail');
    expect(check(r, 'due_date')?.status).toBe('warn');
    expect(check(r, 'supplier_tax_checksum')?.status).toBe('warn');
  });

  it('accepts VAT given as a fraction (0.27)', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', net_amount: 1000, total_vat_amount: 270, total_amount: 1270, vat_lines: [{ vat_rate: 0.27, vat_base: 1000, vat_amount: 270 }], invoice_date: '2026-11-03' }, { today: TODAY });
    expect(r.normalized.vat_lines[0]).toMatchObject({ vat_rate: 27, vat_kind: 'standard_27' });
  });

  it('marks unreadable totals as failures', () => {
    const r = validateExtractedInvoice({ currency: 'HUF', invoice_date: '2026-11-03' }, { today: TODAY });
    expect(check(r, 'gross_missing')?.status).toBe('fail');
  });
});
