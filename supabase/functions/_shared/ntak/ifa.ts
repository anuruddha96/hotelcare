/**
 * Tourism tax (IFA) per accommodation-unit night (9.2.17).
 *
 *  - SZAZALEKOS (percentage): the VAT-exclusive accommodation fee per guest
 *    staying in the unit x rate, for each taxable guest. Spec example: fee 100,
 *    4 guests, 2 taxable, 4 %, VAT 5 % -> (100/1.05)*0.04/4*2 = 1.90 -> 2 HUF
 *    for the room, 1 HUF per taxable guest.
 *  - TETELES (fixed): rate x taxable guest nights.
 *  - NINCS: no IFA charge.
 *
 * One IFA charge item is produced per taxable guest (outside the package);
 * the room total is rounded to whole forints and split without losing a forint.
 */
import type { IfaType } from './codes.ts';

export interface IfaSetting { type: IfaType; rate: number }

/** Guests younger than 18 on the night are exempt by law (im1). */
export function autoIfaStatus(birthDate: string | null | undefined, night: string): 'KOTELES' | 'im1' {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return 'KOTELES';
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ny, nm, nd] = night.split('-').map(Number);
  const age = ny - by - (nm < bm || (nm === bm && nd < bd) ? 1 : 0);
  return age < 18 ? 'im1' : 'KOTELES';
}

export function ifaPerGuest(setting: IfaSetting | null | undefined, accommodationGross: number, accommodationVat: number, guestStatuses: string[]): number[] {
  if (!setting || setting.type === 'NINCS' || !guestStatuses.length) return [];
  const taxable = guestStatuses.filter((s) => s === 'KOTELES').length;
  if (!taxable) return [];
  let roomTotal: number;
  if (setting.type === 'TETELES') {
    roomTotal = Math.round(setting.rate * taxable);
  } else {
    const net = Math.max(0, accommodationGross) / (1 + accommodationVat / 100);
    roomTotal = Math.round((net / guestStatuses.length) * (setting.rate / 100) * taxable);
  }
  const base = Math.floor(roomTotal / taxable);
  const rest = roomTotal - base * taxable;
  return Array.from({ length: taxable }, (_, i) => base + (i < rest ? 1 : 0));
}
