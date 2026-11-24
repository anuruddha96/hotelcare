/**
 * Map a HotelCare guest row to VIZA scanned/manual field groups.
 *
 * `document_scan` on the guest row is the document-reader output captured at
 * check-in, already in VIZA vocabulary and stored unchanged (spec: scanned
 * data must be forwarded without modification). Everything the receptionist
 * typed or corrected lives in the normal guest columns; any value that
 * differs from the scan — or exists without a scanned counterpart — goes into
 * the manual group.
 */
import { iso3ToIso2 } from './country.ts';
import type { VizaGuestFields } from './messages.ts';

export interface GuestRowForViza {
  first_name?: string | null;
  last_name?: string | null;
  birth_last_name?: string | null;
  birth_first_name?: string | null;
  date_of_birth?: string | null;
  birth_place?: string | null;
  mother_name?: string | null;
  mother_family_name?: string | null;
  mother_given_name?: string | null;
  gender?: string | null; // male | female | other
  nationality?: string | null; // alpha-2 or alpha-3
  id_document_type?: string | null; // passport | id_card | driving_licence | …
  id_document_number?: string | null;
  visa_number?: string | null;
  document_scan?: { fields?: VizaGuestFields | null } | null;
}

export const GENDER_TO_VIZA: Record<string, VizaGuestFields['nem']> = {
  male: 'FERFI',
  female: 'NO',
  other: 'EGYEB_VAGY_NEM_ISMERT',
};

export const DOC_TYPE_TO_VIZA: Record<string, VizaGuestFields['okmanyTipus']> = {
  passport: 'UTLEVEL',
  id_card: 'SZEM_IG',
  driving_licence: 'VEZ_ENG',
};

/** Split "mother name" free text into family + given parts (Hungarian order). */
export function splitMotherName(value: string | null | undefined): { csalad: string | null; uto: string | null } {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { csalad: null, uto: null };
  const parts = text.split(' ');
  if (parts.length === 1) return { csalad: parts[0], uto: null };
  return { csalad: parts[0], uto: parts.slice(1).join(' ') };
}

const norm = (v: string | null | undefined) => String(v ?? '').trim();
const same = (a: string | null | undefined, b: string | null | undefined) =>
  norm(a).toLocaleLowerCase() === norm(b).toLocaleLowerCase();

export function guestToVizaGroups(guest: GuestRowForViza): { scanned: VizaGuestFields | null; manual: VizaGuestFields | null } {
  const scanned: VizaGuestFields | null = guest.document_scan?.fields ?? null;
  const mother = guest.mother_family_name != null || guest.mother_given_name != null
    ? { csalad: norm(guest.mother_family_name) || null, uto: norm(guest.mother_given_name) || null }
    : splitMotherName(guest.mother_name);
  const current: VizaGuestFields = {
    csaladnev: norm(guest.last_name) || null,
    utonev: norm(guest.first_name) || null,
    szuletesiCsaladnev: norm(guest.birth_last_name) || null,
    szuletesiUtonev: norm(guest.birth_first_name) || null,
    szuletesiDatum: norm(guest.date_of_birth) || null,
    szuletesiHely: norm(guest.birth_place) || null,
    anyjaCsaladnev: mother.csalad,
    anyjaUtonev: mother.uto,
    allampolgarsagKod: iso3ToIso2(guest.nationality) ?? (norm(guest.nationality) || null),
    nem: guest.gender ? GENDER_TO_VIZA[guest.gender] ?? 'EGYEB_VAGY_NEM_ISMERT' : null,
    okmanyTipus: guest.id_document_type ? DOC_TYPE_TO_VIZA[guest.id_document_type] ?? 'EGYEB' : null,
    okmanyAzonositoSzam: norm(guest.id_document_number) || null,
  };

  const manual: VizaGuestFields = {};
  let hasManual = false;
  for (const key of Object.keys(current) as (keyof VizaGuestFields)[]) {
    const value = current[key];
    if (value === null || value === undefined || value === '') continue;
    const scannedValue = scanned?.[key];
    if (scannedValue === undefined || scannedValue === null || scannedValue === ''
      || !same(String(scannedValue), String(value))) {
      (manual as Record<string, unknown>)[key] = value;
      hasManual = true;
    }
  }

  // THF requires both halves of each name pair in the manual block.
  // If either half differs, transmit both reviewed values, while leaving the
  // original reader payload intact (including accents and letter case).
  for (const [family, given] of [
    ['csaladnev', 'utonev'],
    ['szuletesiCsaladnev', 'szuletesiUtonev'],
    ['anyjaCsaladnev', 'anyjaUtonev'],
  ] as const) {
    if (manual[family] != null || manual[given] != null) {
      manual[family] = current[family];
      manual[given] = current[given];
    }
  }

  const hasScan = !!scanned && Object.values(scanned).some((v) => v !== null && v !== undefined && v !== '');
  return { scanned: hasScan ? scanned : null, manual: hasManual ? manual : null };
}
