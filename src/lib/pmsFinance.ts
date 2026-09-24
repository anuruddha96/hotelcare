export const PMS_PAYMENT_METHODS = [
  'cash',
  'card_terminal',
  'online_card',
  'bank_transfer',
  'coupon',
  'szep_otp',
  'szep_mbh',
  'szep_kh',
  'other',
] as const;

export type PmsPaymentMethod = typeof PMS_PAYMENT_METHODS[number];

export interface FinancialLineLike {
  gross_total?: number | string | null;
  status?: string | null;
}

export interface PaymentLike {
  amount?: number | string | null;
  status?: string | null;
}

export interface FinancialSummary {
  base: number;
  extras: number;
  charges: number;
  paid: number;
  balance: number;
}

const money = (value: unknown): number => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

export function calculateGrossLine(
  quantity: number,
  grossUnitPrice: number,
  vatRate: number | null,
): { gross: number; net: number; vat: number } {
  const gross = money(quantity * grossUnitPrice);
  if (vatRate === null || !Number.isFinite(vatRate)) {
    return { gross, net: gross, vat: 0 };
  }
  const net = money(gross / (1 + vatRate / 100));
  return { gross, net, vat: money(gross - net) };
}

export function summarizeFinancialAccount(
  baseReservationAmount: number | string | null | undefined,
  lines: FinancialLineLike[],
  payments: PaymentLike[],
): FinancialSummary {
  const base = money(baseReservationAmount);
  const extras = money(
    lines
      .filter((line) => ['open', 'invoiced', undefined, null].includes(line.status as never))
      .reduce((sum, line) => sum + Number(line.gross_total ?? 0), 0),
  );
  const paid = money(
    payments
      .filter((payment) => ['recorded', 'captured'].includes(String(payment.status ?? '')))
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
  );
  const charges = money(base + extras);
  return { base, extras, charges, paid, balance: money(charges - paid) };
}

export function canManagePmsServiceCatalogue(role: string | null | undefined): boolean {
  return ['admin', 'manager', 'top_management', 'top_management_manager'].includes(String(role ?? ''));
}
