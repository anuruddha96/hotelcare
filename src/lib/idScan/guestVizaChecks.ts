/**
 * Front-desk checks for the Hungarian guest registration (VIZA) form.
 *
 * Mirrors the rules the THF applies on arrival (interface guide, chapter 6),
 * so reception sees a problem while the guest is still at the desk instead of
 * a rejection afterwards. Pure functions: guest row in, findings out.
 */
import { ISO3_TO_ISO2, iso3ToIso2 } from '../../../supabase/functions/_shared/viza/country';
import type { VizaDocumentScan } from './vizaScan';

export interface GuestVizaValues {
  first_name?: string | null;
  last_name?: string | null;
  birth_last_name?: string | null;
  birth_first_name?: string | null;
  mother_name?: string | null;
  mother_family_name?: string | null;
  mother_given_name?: string | null;
  viza_review?: VizaReview | null;
  nationality?: string | null;
  date_of_birth?: string | null;
  birth_place?: string | null;
  gender?: string | null;
  id_document_type?: string | null;
  id_document_number?: string | null;
  visa_number?: string | null;
  entry_date?: string | null;
  entry_place?: string | null;
}

export interface VizaReview {
  reservation_id?: string;
  birth_name_absent?: boolean;
  birth_place_absent?: boolean;
  mother_name_absent?: boolean;
  visa_exempt?: boolean;
  entry_details_absent?: boolean;
  manual_reason?: string;
  scan_reviewed?: boolean;
  parent_statement?: boolean;
}
const ISO2 = new Set(Object.values(ISO3_TO_ISO2));
const FREE_MOVEMENT = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH'.split(' '));
export const isHungarianId = (guest: GuestVizaValues) => iso3ToIso2(guest.nationality) === 'HU' && guest.id_document_type === 'id_card';
export const thirdCountry = (guest: GuestVizaValues) => {
  const code = iso3ToIso2(guest.nationality);
  return !!code && ISO2.has(code) && !FREE_MOVEMENT.has(code);
};
const validDate = (v: string | null | undefined): boolean => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const date = new Date(v + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
};
const filled = (v: unknown) => String(v ?? '').trim() !== '';
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Hotel business date, rather than browser/UTC midnight, drives admission age. */
export function vizaArrivalDay(occurredAt?: string | null): Date {
  const instant = occurredAt ? new Date(occurredAt) : new Date();
  const safe = Number.isFinite(instant.getTime()) ? instant : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(safe);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return new Date(part('year') + '-' + part('month') + '-' + part('day') + 'T00:00:00Z');
}

/** Age in full years on a given day; null without a usable birth date. */
export function ageOn(dateOfBirth: string | null | undefined, day = new Date()): number | null {
  if (!validDate(dateOfBirth) || !dateOfBirth) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const today = isoDay(day).split('-').map(Number);
  let age = today[0] - y;
  if (today[1] < m || (today[1] === m && today[2] < d)) age -= 1;
  return age;
}

/** Guests under 14 do not have to show a document (Act CLVI of 2016 § 9/H (2a); guide 6.3). */
export const documentRequired = (dateOfBirth: string | null | undefined, day = new Date()): boolean => {
  const age = ageOn(dateOfBirth, day);
  return age === null || age >= 14;
};

/** Fields that must be filled before the arrival can be reported. */
export function vizaMissingFields(guest: GuestVizaValues | null | undefined, day = new Date()): string[] {
  const always = ['last_name', 'first_name', 'nationality', 'date_of_birth', 'birth_place', 'gender'] as const;
  const document = ['id_document_type', 'id_document_number'] as const;
  if (!guest) return [...always, ...document];
  const required: readonly (keyof GuestVizaValues)[] = documentRequired(guest.date_of_birth, day) ? [...always, ...document] : always;
  return required.filter((field) => !filled(guest[field]));
}

export type VizaProblem = 'birthNamePair' | 'motherName' | 'entryDate' | 'nationality' | 'birthDate';

/** Values that are filled but the THF would refuse. */
export function vizaProblems(guest: GuestVizaValues | null | undefined, day = new Date()): VizaProblem[] {
  if (!guest) return [];
  const problems: VizaProblem[] = [];
  if (filled(guest.birth_last_name) !== filled(guest.birth_first_name)) problems.push('birthNamePair');
  // The mother's name is sent as family + given name: one word alone is refused.
  if (filled(guest.mother_name) && String(guest.mother_name).trim().split(/\s+/).length < 2) problems.push('motherName');
  if (filled(guest.entry_date) && String(guest.entry_date) > isoDay(day)) problems.push('entryDate');
  if (filled(guest.nationality) && !ISO2.has(iso3ToIso2(guest.nationality) ?? '')) problems.push('nationality');
  const age = ageOn(guest.date_of_birth, day);
  if (filled(guest.date_of_birth) && (age === null || age < 0 || age > 110 || String(guest.date_of_birth) > isoDay(day))) problems.push('birthDate');
  return problems;
}

/** Admission rules for a VIZA-enabled stay; exceptions are explicit and stay-scoped. */
export function vizaAdmissionFields(guest: GuestVizaValues | null | undefined, reservationId: string, day = vizaArrivalDay()): string[] {
  if (!guest) return vizaMissingFields(null);
  const missing = vizaMissingFields(guest, day).filter(f => f !== 'birth_place');
  const review = guest.viza_review?.reservation_id === reservationId ? guest.viza_review : {};
  const add = (field: string) => { if (!missing.includes(field)) missing.push(field); };
  const requiredDoc = documentRequired(guest.date_of_birth, day);
  const hasDoc = filled(guest.id_document_type) && filled(guest.id_document_number);
  const childWithoutDoc = !requiredDoc && !hasDoc;
  const noExceptions = isHungarianId(guest) || childWithoutDoc;
  const checkPair = (a: keyof GuestVizaValues, b: keyof GuestVizaValues, absent: boolean | undefined) => {
    if (filled(guest[a]) || filled(guest[b]) || noExceptions || !absent) {
      if (!filled(guest[a])) add(a);
      if (!filled(guest[b])) add(b);
    }
  };
  checkPair('birth_last_name', 'birth_first_name', review.birth_name_absent);
  checkPair('mother_family_name', 'mother_given_name', review.mother_name_absent);
  if (!filled(guest.birth_place) && (noExceptions || !review.birth_place_absent)) add('birth_place');
  for (const field of ['first_name','last_name','birth_first_name','birth_last_name','mother_family_name','mother_given_name'] as const) {
    const value = String(guest[field] ?? '').trim();
    if ([...value].length > 200 || new TextEncoder().encode(value).length > 254) add(field);
  }
  if (!['male','female','other'].includes(guest.gender ?? '')) add('gender');
  if ((requiredDoc || filled(guest.id_document_type)) && !['passport','id_card','driving_licence','other'].includes(guest.id_document_type ?? '')) add('id_document_type');
  if (String(guest.id_document_number ?? '').length > 100 || (!childWithoutDoc && !hasDoc)) add('id_document_number');
  if (!ISO2.has(iso3ToIso2(guest.nationality) ?? '')) add('nationality');
  const oldest = new Date(day);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 110);
  if (!validDate(guest.date_of_birth) || String(guest.date_of_birth) < isoDay(oldest) || vizaProblems(guest, day).includes('birthDate')) add('date_of_birth');
  if (thirdCountry(guest)) {
    if (filled(guest.entry_date) ? !validDate(guest.entry_date) || String(guest.entry_date) > isoDay(day) : !review.entry_details_absent) add('entry_date');
    if ((!filled(guest.entry_place) && !review.entry_details_absent) || [...String(guest.entry_place ?? '').trim()].length > 200 || new TextEncoder().encode(String(guest.entry_place ?? '').trim()).length > 254) add('entry_place');
    if ((!filled(guest.visa_number) && !review.visa_exempt) || String(guest.visa_number ?? '').length > 100) add('visa_number');
  }
  if (childWithoutDoc) {
    if (!review.parent_statement) add('parent_statement');
  } else if (!review.scan_reviewed && !filled(review.manual_reason)) add('manual_reason');
  return missing;
}

const GENDER_TO_VIZA: Record<string, string> = { male: 'FERFI', female: 'NO', other: 'EGYEB_VAGY_NEM_ISMERT' };
const DOC_TO_VIZA: Record<string, string> = { passport: 'UTLEVEL', id_card: 'SZEM_IG', driving_licence: 'VEZ_ENG', other: 'EGYEB' };

export type ScanFieldState = 'fromDocument' | 'corrected' | null;

/**
 * How a form field relates to what the reader took from the document:
 * unchanged, corrected by hand, or not on the document at all. The same
 * comparison decides what the arrival message carries as a manual correction.
 */
export function scanFieldState(field: keyof GuestVizaValues, guest: GuestVizaValues, scan: VizaDocumentScan | null | undefined): ScanFieldState {
  const read = scan?.fields;
  if (!read) return null;
  const pairs: Partial<Record<keyof GuestVizaValues, [string | null | undefined, string | null]>> = {
    last_name: [read.csaladnev, guest.last_name ?? null],
    first_name: [read.utonev, guest.first_name ?? null],
    date_of_birth: [read.szuletesiDatum, guest.date_of_birth ?? null],
    nationality: [read.allampolgarsagKod, iso3ToIso2(guest.nationality) ?? guest.nationality ?? null],
    gender: [read.nem, guest.gender ? GENDER_TO_VIZA[guest.gender] ?? null : null],
    id_document_type: [read.okmanyTipus, guest.id_document_type ? DOC_TO_VIZA[guest.id_document_type] ?? 'EGYEB' : null],
    id_document_number: [read.okmanyAzonositoSzam, guest.id_document_number ?? null],
  };
  const pair = pairs[field];
  if (!pair || !filled(pair[0])) return null;
  const same = String(pair[0]).trim().toLocaleLowerCase() === String(pair[1] ?? '').trim().toLocaleLowerCase();
  return same ? 'fromDocument' : 'corrected';
}
