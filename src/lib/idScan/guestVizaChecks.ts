/**
 * Front-desk checks for the Hungarian guest registration (VIZA) form.
 *
 * Mirrors the rules the THF applies on arrival (interface guide, chapter 6),
 * so reception sees a problem while the guest is still at the desk instead of
 * a rejection afterwards. Pure functions: guest row in, findings out.
 */
import { ISO3_TO_ISO2, iso3ToIso2 } from '../../../supabase/functions/_shared/viza/country';
import { isVizaPlaceholder, isThirdCountryNationality, validEntryAbsence, type EntryDetailsReason } from '../../../supabase/functions/_shared/viza/fieldRules';
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
  document_scan?: unknown;
}

export interface VizaReview {
  reservation_id?: string;
  birth_name_absent?: boolean;
  birth_place_absent?: boolean;
  mother_name_absent?: boolean;
  visa_exempt?: boolean;
  entry_details_absent?: boolean;
  entry_details_reason?: EntryDetailsReason;
  entry_details_reason_text?: string;
  manual_reason?: string;
  scan_reviewed?: boolean;
  parent_statement?: boolean;
}
const ISO2 = new Set(Object.values(ISO3_TO_ISO2));
export const isHungarianId = (guest: GuestVizaValues) => iso3ToIso2(guest.nationality) === 'HU' && guest.id_document_type === 'id_card';
export const thirdCountry = (guest: GuestVizaValues) => isThirdCountryNationality(guest.nationality);
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
  return required.filter((field) => !filled(guest[field]) || (field === 'birth_place' && (isVizaPlaceholder(guest.birth_place) || !fits(guest.birth_place, 200, 254))));
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

export type VizaFieldState = 'required' | 'printed_only' | 'optional' | 'not_needed';
export type VizaFieldRequirement = { state: VizaFieldState; ok: boolean; messageKey: string };
export type VizaFieldRequirements = Record<string, VizaFieldRequirement>;
const fits = (v: unknown, chars: number, bytes = Infinity) =>
  [...String(v ?? '').trim()].length <= chars && new TextEncoder().encode(String(v ?? '').trim()).length <= bytes;
const messageForState: Record<VizaFieldState, string> = {
  required: 'pms.guest.requirement.required', printed_only: 'pms.guest.requirement.printedOnly',
  optional: 'pms.guest.requirement.optional', not_needed: 'pms.guest.requirement.notNeeded',
};

/** One local admission matrix; stay-scoped review flags never imply a printed field is present. */
export function vizaFieldRequirements(guest: GuestVizaValues | null | undefined, reservationId: string, day = vizaArrivalDay()): VizaFieldRequirements {
  const g: GuestVizaValues = guest ?? {};
  const result: VizaFieldRequirements = {};
  const review: VizaReview = g.viza_review?.reservation_id === reservationId ? g.viza_review : {};
  const put = (field: string, state: VizaFieldState, ok: boolean, placeholder = false, tooLong: 100 | 200 | null = null) => {
    result[field] = { state, ok, messageKey: placeholder ? 'pms.guest.requirement.placeholder'
      : !ok && tooLong === 200 ? 'pms.guest.requirement.tooLong'
      : !ok && tooLong === 100 ? 'pms.guest.requirement.tooLong100' : messageForState[state] };
  };
  const requiredDoc = documentRequired(g.date_of_birth, day);
  const hasDoc = filled(g.id_document_type) && filled(g.id_document_number);
  const childWithoutDoc = !requiredDoc && !hasDoc;
  const noExceptions = isHungarianId(g) || childWithoutDoc;
  const printedState = noExceptions ? 'required' : 'printed_only';
  for (const field of ['last_name','first_name'] as const) put(field,'required',filled(g[field]) && fits(g[field],200,254),false,filled(g[field]) && !fits(g[field],200,254) ? 200 : null);
  const checkPair = (a: keyof GuestVizaValues, b: keyof GuestVizaValues, absent?: boolean) => {
    const bothAbsent = !filled(g[a]) && !filled(g[b]) && !noExceptions && absent === true;
    for (const field of [a,b]) {
      const placeholder = isVizaPlaceholder(g[field]);
      put(field,printedState,bothAbsent || (filled(g[field]) && !placeholder && fits(g[field],200,254)),placeholder,filled(g[field]) && !placeholder && !fits(g[field],200,254) ? 200 : null);
    }
  };
  checkPair('birth_last_name','birth_first_name',review.birth_name_absent);
  checkPair('mother_family_name','mother_given_name',review.mother_name_absent);
  const birthPlaceholder = isVizaPlaceholder(g.birth_place);
  put('birth_place',printedState,filled(g.birth_place) ? !birthPlaceholder && fits(g.birth_place,200,254) : !noExceptions && review.birth_place_absent === true,birthPlaceholder,filled(g.birth_place) && !birthPlaceholder && !fits(g.birth_place,200,254) ? 200 : null);
  put('nationality','required',ISO2.has(iso3ToIso2(g.nationality) ?? ''));
  const oldest = new Date(day); oldest.setUTCFullYear(oldest.getUTCFullYear() - 110);
  put('date_of_birth','required',validDate(g.date_of_birth) && String(g.date_of_birth) >= isoDay(oldest) && String(g.date_of_birth) <= isoDay(day));
  put('gender','required',['male','female','other'].includes(g.gender ?? ''));
  const docType = ['passport','id_card','driving_licence','other'].includes(g.id_document_type ?? '');
  put('id_document_type',childWithoutDoc ? 'optional' : 'required',(!requiredDoc && !filled(g.id_document_type)) || docType);
  put('id_document_number',childWithoutDoc ? 'optional' : 'required',fits(g.id_document_number,100) && (childWithoutDoc || hasDoc),false,(childWithoutDoc || hasDoc) && !fits(g.id_document_number,100) ? 100 : null);
  const third = thirdCountry(g);
  const entryAbsent = third && validEntryAbsence(review);
  const permit = third && review.entry_details_absent === true && review.entry_details_reason === 'lives_in_hungary_with_permit';
  const visaExempt = third && review.visa_exempt === true && !permit;
  const entryState = !third || entryAbsent ? 'not_needed' : 'required';
  const visaState = !third || visaExempt ? 'not_needed' : 'required';
  const visaPlaceholder = isVizaPlaceholder(g.visa_number), placePlaceholder = isVizaPlaceholder(g.entry_place);
  put('entry_date',entryState,entryState === 'not_needed' || (validDate(g.entry_date) && String(g.entry_date) <= isoDay(day) && (!validDate(g.date_of_birth) || String(g.entry_date) >= String(g.date_of_birth))));
  put('entry_place',entryState,entryState === 'not_needed' || (filled(g.entry_place) && !placePlaceholder && fits(g.entry_place,200,254)),entryState !== 'not_needed' && placePlaceholder,entryState !== 'not_needed' && filled(g.entry_place) && !placePlaceholder && !fits(g.entry_place,200,254) ? 200 : null);
  put('visa_number',visaState,visaState === 'not_needed' || (filled(g.visa_number) && !visaPlaceholder && fits(g.visa_number,100) && (!permit || review.visa_exempt !== true)),visaState !== 'not_needed' && visaPlaceholder,visaState !== 'not_needed' && filled(g.visa_number) && !visaPlaceholder && (!permit || review.visa_exempt !== true) && !fits(g.visa_number,100) ? 100 : null);
  put('entry_details_reason',third && review.entry_details_absent ? 'required' : 'not_needed',!third || !review.entry_details_absent || entryAbsent);
  put('parent_statement',childWithoutDoc ? 'required' : 'not_needed',!childWithoutDoc || review.parent_statement === true);
  const reviewed = review.scan_reviewed === true && g.document_scan != null;
  put('manual_reason',childWithoutDoc || reviewed ? 'not_needed' : 'required',childWithoutDoc || reviewed || filled(review.manual_reason));
  return result;
}

export function vizaAdmissionFields(guest: GuestVizaValues | null | undefined, reservationId: string, day = vizaArrivalDay()): string[] {
  return Object.entries(vizaFieldRequirements(guest,reservationId,day)).filter(([, field]) => !field.ok).map(([key]) => key);
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
