/** Walk-in ledger -> NTAK other revenue; no booking or guest linkage. */
import { categoryProblem, PAYMENT_TYPES, VAT_RATES, type VatRate } from './codes.ts';
import { mapPayments, type LedgerConfig } from './ledger.ts';
import type { NtakCharge, NtakPayment } from './messages.ts';

export interface PosSale { id: string }
export interface PosLine { sale_id: string; gross_total: number | string; vat_rate: number | string; ntak_main: string; ntak_sub: string }
export interface PosPayment { sale_id: string; method: string; amount: number | string }

const aliases: Record<string, string> = {
  card_terminal: 'card', online_card: 'card', coupon: 'voucher',
  szep_otp: 'szep_card', szep_mbh: 'szep_card', szep_kh: 'szep_card', other: 'legacy',
};

function cents(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  const rounded = Math.round(n * 100);
  return Number.isFinite(n) && n > 0 && Number.isSafeInteger(rounded)
    && Math.abs(n * 100 - rounded) < 0.001 ? rounded : null;
}

export function mapWalkInSales(sales: PosSale[], lines: PosLine[], payments: PosPayment[], cfg: LedgerConfig): {
  otherCharges: NtakCharge[]; otherPayments: NtakPayment[]; problems: string[];
} {
  const problems: string[] = [];
  const otherCharges: NtakCharge[] = [];
  const gross = new Map(sales.map(s => [s.id, 0]));
  const paid = new Map(sales.map(s => [s.id, 0]));
  const mappedPayments = [];
  // Sort deterministic snapshots, even if the database returns a new row order.
  const sortedLines = [...lines].sort((a,b) =>
    a.sale_id.localeCompare(b.sale_id) || a.ntak_main.localeCompare(b.ntak_main)
    || a.ntak_sub.localeCompare(b.ntak_sub) || Number(a.vat_rate)-Number(b.vat_rate)
    || Number(a.gross_total)-Number(b.gross_total));
  for (const l of sortedLines) {
    const amount = cents(l.gross_total);
    const vat = Number(l.vat_rate);
    if (!gross.has(l.sale_id) || amount === null || l.vat_rate == null || !VAT_RATES.includes(vat as VatRate)) {
      problems.push('Invalid walk-in charge for sale '+l.sale_id); continue;
    }
    const problem = categoryProblem('other', l.ntak_main, l.ntak_sub);
    if (problem) { problems.push('Walk-in sale '+l.sale_id+': '+problem); continue; }
    gross.set(l.sale_id, gross.get(l.sale_id)! + amount);
    // Preserve sale-time category and VAT; later catalogue edits must not
    // retroactively change historical closure classifications.
    otherCharges.push({ amount: amount/100, main: l.ntak_main, sub: l.ntak_sub, vat: vat as VatRate });
  }
  for (const p of [...payments].sort((a,b) => a.sale_id.localeCompare(b.sale_id) || a.method.localeCompare(b.method))) {
    const amount = cents(p.amount);
    const method = p.method.trim().toLowerCase();
    const mappedMethod = cfg.paymentMap[method] ? method : aliases[method] ?? method;
    if (!paid.has(p.sale_id) || amount === null || !PAYMENT_TYPES.includes(cfg.paymentMap[mappedMethod])) {
      problems.push('Invalid walk-in payment for sale '+p.sale_id); continue;
    }
    paid.set(p.sale_id, paid.get(p.sale_id)! + amount);
    mappedPayments.push({ reservation_id: p.sale_id, amount: amount/100, currency: 'HUF',
      method: mappedMethod, status: 'recorded', received_at: '' });
  }
  for (const sale of sales) {
    if (!gross.get(sale.id) || gross.get(sale.id) !== paid.get(sale.id)) {
      problems.push('Unbalanced or empty walk-in sale '+sale.id);
    }
  }
  const otherPayments = mapPayments(mappedPayments, cfg, problems).sort((a,b)=>a.type.localeCompare(b.type));
  return { otherCharges, otherPayments, problems };
}
