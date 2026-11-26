import { hasPassportBirthplaceLabel } from './passportBirthPlace';
import type { MrzReadResult } from './mrz';
import { extractOpticalGuestFields, type OpticalGuestFields } from './opticalGuestFields';
import type { GuestVizaValues, VizaReview } from './guestVizaChecks';

export const PASSPORT_ABSENCE_KEYS = ['birth_name_absent', 'mother_name_absent', 'birth_place_absent'] as const;
export type PassportAbsenceKey = typeof PASSPORT_ABSENCE_KEYS[number];
export type PassportAbsences = Partial<Record<PassportAbsenceKey, true>>;

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const labels: Record<PassportAbsenceKey, RegExp> = {
  birth_name_absent: /name[s]?\s+at\s+birth|birth\s+(?:name|surname|given)|maiden\s+name|szuletesi\s+(?:nev|csalad|uto)|nom\s+de\s+naissance|geburtsname|apellido[s]?\s+de\s+nacimiento|cognome\s+alla\s+nascita|nome\s+de\s+nascimento/i,
  mother_name_absent: /mother|anyja|mutter|mere|madre|mae|мать|матери|мати|матері/i,
  birth_place_absent: /place\s+of\s+birth|birth\s*place|szuletesi\s+hely|lieu\s+de\s+naissance|geburtsort|lugar\s+de\s+nacimiento|local\s+de\s+nascimento|luogo\s+di\s+nascita|dogum\s+yeri|место\s+рождения|місце\s+народження|出生地|出身地/i,
};
const has = (v: unknown) => typeof v === 'string' && !!v.trim();
const fields: Record<PassportAbsenceKey, (keyof GuestVizaValues)[]> = {
  birth_name_absent: ['birth_last_name', 'birth_first_name'],
  mother_name_absent: ['mother_name', 'mother_family_name', 'mother_given_name'],
  birth_place_absent: ['birth_place'],
};
export const absenceGroupEmpty = (guest: GuestVizaValues, key: PassportAbsenceKey) => fields[key].every(field => !has(guest[field]));

/** A readable photo page can propose unchecked-by-OCR fields for physical
 * review. It cannot certify absence: staff must confirm the displayed list.
 * MRZ-only readers, failed OCR, unreadable photos and visible but unresolved
 * printed labels never produce automatic absence proposals. */
export function suggestPassportAbsences(
  result: MrzReadResult, optical: OpticalGuestFields, reads: string[], score: number | null,
): PassportAbsences {
  if (result.format !== 'TD3' || result.fields.documentType !== 'passport' || !result.valid ||
      result.unknownCountry || score === null || score < 80 || reads.length < 2) return {};
  const transcripts = reads.map(fold);
  // Require readable visual-zone labels, not just a successful MRZ decode.
  const visualLabels = /surname|family\s+name|given\s+name|date\s+of\s+birth|nationality|nom\b|prenom|geburtsdatum|apellido|nationalitat|allampolgarsag|utonev|csaladnev|fecha\s+de\s+nacimiento/g;
  if (!transcripts.every(text => new Set(text.match(visualLabels) ?? []).size >= 2)) return {};
  const independentlyExtracted = reads.map(extractOpticalGuestFields);
  const proposed: PassportAbsences = {};
  for (const key of PASSPORT_ABSENCE_KEYS) {
    if (absenceGroupEmpty(optical, key) &&
        independentlyExtracted.every(read => absenceGroupEmpty(read, key)) &&
        transcripts.every(text => !labels[key].test(text) && (key !== 'birth_place_absent' || !hasPassportBirthplaceLabel(text)))) proposed[key] = true;
  }
  return proposed;
}

/** Apply only physically confirmed proposals, never overwrite existing data
 * or carry passport exemptions into another document type. */
export function passportAbsenceReview(
  guest: GuestVizaValues, result: MrzReadResult, confirmed: PassportAbsences = {},
): Partial<VizaReview> {
  const out: Partial<VizaReview> = {};
  if (result.fields.documentType !== 'passport' || result.format !== 'TD3' || !result.valid || result.unknownCountry) return out;
  for (const key of PASSPORT_ABSENCE_KEYS) {
    if (!absenceGroupEmpty(guest, key)) out[key] = false;
    else if (confirmed[key] === true) out[key] = true;
  }
  return out;
}
