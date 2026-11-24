import { ISO3_TO_ISO2, iso3ToIso2 } from './country.ts';

const ISO2 = new Set(Object.values(ISO3_TO_ISO2));
const FREE_MOVEMENT = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH'.split(' '));
const PLACEHOLDERS = new Set(['na', 'n/a', 'n.a.', 'nincs', 'none', 'null', 'unknown', '-', '--', 'x', '?']);
export const ENTRY_DETAILS_REASONS = ['lives_in_hungary_with_permit', 'other'] as const;
export type EntryDetailsReason = typeof ENTRY_DETAILS_REASONS[number];

export function isVizaPlaceholder(value: unknown): boolean {
  const normalized = String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return PLACEHOLDERS.has(normalized) || /^0+$/.test(normalized);
}
export const isThirdCountryNationality = (nationality?: string | null): boolean => {
  const country = iso3ToIso2(nationality);
  return !!country && ISO2.has(country) && !FREE_MOVEMENT.has(country);
};
export interface EntryReview {
  reservation_id?: string;
  visa_exempt?: boolean;
  entry_details_absent?: boolean;
  entry_details_reason?: EntryDetailsReason;
  entry_details_reason_text?: string;
}
export function validEntryAbsence(review: EntryReview): boolean {
  return review.entry_details_absent === true && (
    review.entry_details_reason === 'lives_in_hungary_with_permit' ||
    (review.entry_details_reason === 'other' && [...String(review.entry_details_reason_text ?? '').trim()].length >= 10)
  );
}
interface GuestEntry {
  nationality?: string | null;
  visa_number?: string | null;
  entry_date?: string | null;
  entry_place?: string | null;
  viza_review?: EntryReview | null;
}
const nonPlaceholder = (v: string | null | undefined): string | null => {
  const value = String(v ?? '').trim();
  return value && !isVizaPlaceholder(value) ? value : null;
};
/** Admission validates completeness; this final mapping prevents placeholder or inapplicable extras from leaking into XML. */
export function vizaArrivalExtras(guest: GuestEntry | null | undefined, reservationId: string) {
  const review: EntryReview = guest?.viza_review?.reservation_id === reservationId ? guest.viza_review : {};
  const relevant = isThirdCountryNationality(guest?.nationality);
  const permit = review.entry_details_absent === true && review.entry_details_reason === 'lives_in_hungary_with_permit';
  const visaExempt = review.visa_exempt === true && !permit;
  return {
    vizumEngedelySzam: relevant && !visaExempt ? nonPlaceholder(guest?.visa_number) : null,
    beutazasDatuma: relevant && !validEntryAbsence(review) ? nonPlaceholder(guest?.entry_date) : null,
    beutazasHelye: relevant && !validEntryAbsence(review) ? nonPlaceholder(guest?.entry_place) : null,
  };
}
