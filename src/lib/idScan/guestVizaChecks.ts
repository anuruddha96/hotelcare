/**
 * Front-desk checks for the Hungarian guest registration (VIZA) form.
 *
 * Mirrors the rules the THF applies on arrival (interface guide, chapter 6),
 * so reception sees a problem while the guest is still at the desk instead of
 * a rejection afterwards. Pure functions: guest row in, findings out.
 */
import { iso3ToIso2 } from '../../../supabase/functions/_shared/viza/country';
import type { VizaDocumentScan } from './vizaScan';

export interface GuestVizaValues {
  first_name?: string | null;
  last_name?: string | null;
  birth_last_name?: string | null;
  birth_first_name?: string | null;
  mother_name?: string | null;
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

const filled = (v: unknown) => String(v ?? '').trim() !== '';
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Age in full years on a given day; null without a usable birth date. */
export function ageOn(dateOfBirth: string | null | undefined, day = new Date()): number | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [y, m, d] = dateOfBirth.split('-').map(Number);
  const today = isoDay(day).split('-').map(Number);
  let age = today[0] - y;
  if (today[1] < m || (today[1] === m && today[2] < d)) age -= 1;
  return age;
}

/** Guests under 14 do not have to show a document (584/2021. Korm. rendelet; guide 6.3). */
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
  if (filled(guest.nationality) && !iso3ToIso2(guest.nationality) ) problems.push('nationality');
  const age = ageOn(guest.date_of_birth, day);
  if (filled(guest.date_of_birth) && (age === null || age < 0 || age > 110)) problems.push('birthDate');
  return problems;
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
