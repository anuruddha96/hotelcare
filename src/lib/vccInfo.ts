/**
 * Virtual credit card (VCC) facts for a reservation — read-only.
 *
 * What HotelCare can know without ever touching card data:
 *   - whether the OTA pays the stay with a virtual card,
 *   - from which date the card can be charged,
 *   - how much there is to charge and whether Previo already shows it paid,
 *   - where the card itself can be viewed.
 *
 * Card numbers never pass through here. For Channex bookings they are shown
 * inside the PCI vault window (PciCardPanel); for Previo bookings they stay in
 * Previo / the OTA extranet, because Previo's API does not hand out card data.
 */
import { parsePrevioReservationNote } from './previoReservationNote';

export type VccState = 'charged' | 'chargeable' | 'not_yet' | 'unknown';
export type VccCardLocation = 'pci_vault' | 'pms' | 'extranet';

export interface VccReservation {
  source?: string | null;
  status?: string | null;
  special_requests?: string | null;
  pms_group_note?: string | null;
  pms_channel?: string | null;
  ota_name?: string | null;
  payment_collect?: string | null;
  channex_booking_id?: string | null;
  pms_payment_status?: string | null;
  total_amount?: number | string | null;
  balance_due?: number | string | null;
  currency?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
}

export interface VccInfo {
  /** The OTA collects from the guest and pays the property by virtual card. */
  virtualCard: boolean;
  /** How sure we are: the booking text says so, or it is only inferred from "OTA collects". */
  confidence: 'stated' | 'inferred';
  state: VccState;
  /** YYYY-MM-DD from which the card accepts a charge, when the OTA stated it. */
  chargeableFrom: string | null;
  /** Whole days until the card can be charged (0 when it already can). */
  daysUntilChargeable: number | null;
  amountToCharge: number | null;
  currency: string | null;
  channel: string | null;
  instructions: string[];
  cardLocation: VccCardLocation;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** Dates in OTA notes come as 2026-11-15, 15.11.2026, 15/11/2026 or "15 November 2026". */
export function normalizeNoteDate(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = value.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const parsed = Date.parse(`${value} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

/** Null when nothing indicates a virtual card (most direct and pay-at-hotel bookings). */
export function deriveVccInfo(r: VccReservation, today: string): VccInfo | null {
  const note = parsePrevioReservationNote([r.special_requests, r.pms_group_note].filter(Boolean).join('\n'));
  const stated = !!note.payment.method && /virtual/i.test(note.payment.method);
  const otaCollects = String(r.payment_collect ?? '').toLowerCase() === 'ota' || note.payment.collectedBy === 'OTA';
  if (!stated && !otaCollects) return null;

  const chargeableFrom = normalizeNoteDate(note.payment.chargeableFrom);
  const total = Number(r.total_amount ?? NaN);
  const balance = Number(r.balance_due ?? NaN);
  const paid = r.pms_payment_status === 'paid' || (Number.isFinite(balance) && Number.isFinite(total) && total > 0 && balance <= 0);

  let state: VccState = 'unknown';
  let daysUntilChargeable: number | null = null;
  if (paid) state = 'charged';
  else if (chargeableFrom && DAY.test(today)) {
    daysUntilChargeable = Math.max(0, dayDiff(today, chargeableFrom));
    state = daysUntilChargeable === 0 ? 'chargeable' : 'not_yet';
  }

  const amountToCharge = paid ? 0
    : Number.isFinite(balance) && balance > 0 ? balance
      : Number.isFinite(total) && total > 0 ? total : null;

  return {
    virtualCard: true,
    confidence: stated ? 'stated' : 'inferred',
    state,
    chargeableFrom,
    daysUntilChargeable,
    amountToCharge,
    currency: r.currency ?? null,
    channel: (r.pms_channel ?? r.ota_name ?? null) || null,
    instructions: note.payment.instructions,
    cardLocation: r.channex_booking_id ? 'pci_vault' : String(r.source ?? '').toLowerCase() === 'previo' ? 'pms' : 'extranet',
  };
}
