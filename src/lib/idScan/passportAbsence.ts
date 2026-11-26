import { hasPassportBirthplaceLabel } from './passportBirthPlace';
import { hasPrintedLabel } from './printedLabels';
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
  const sharedLabelSeen = (key:PassportAbsenceKey,text:string) => key==='birth_name_absent'
    ? hasPrintedLabel(text,'birth_pair')||hasPrintedLabel(text,'birth_last_name')||hasPrintedLabel(text,'birth_first_name')
    : key==='mother_name_absent' ? hasPrintedLabel(text,'mother_name') : hasPrintedLabel(text,'birth_place');
  for (const key of PASSPORT_ABSENCE_KEYS) {
    if (absenceGroupEmpty(optical, key) &&
        independentlyExtracted.every(read => absenceGroupEmpty(read, key)) &&
        transcripts.every(text => !labels[key].test(text) && !sharedLabelSeen(key,text) && (key !== 'birth_place_absent' || !hasPassportBirthplaceLabel(text)))) proposed[key] = true;
  }
  return proposed;
}

/** Preselect the two optional name groups for staff's physical-document review.
 * A recovered visual birthplace also demonstrates that the photo page (not
 * just the MRZ) was read, even when full-page OCR confidence is low. Never
 * default birthplace here, and keep any observed name label/value editable.
 * These are provisional choices; passportAbsenceReview still requires staff
 * confirmation before persisting them. */
export function passportNameAbsenceDefaults(
  result: MrzReadResult, optical: OpticalGuestFields, reads: string[], score: number | null,
  additionalReads: string[] = [],
): PassportAbsences {
  if (result.format !== 'TD3' || result.fields.documentType !== 'passport' ||
      !result.valid || result.unknownCountry) return {};
  const suggestions = suggestPassportAbsences(result, optical, reads, score);
  const photoPageRead = has(optical.birth_place);
  const allReads = [...reads, ...additionalReads];
  const extracted = allReads.map(extractOpticalGuestFields);
  const defaults: PassportAbsences = {};
  for (const key of ['birth_name_absent', 'mother_name_absent'] as const) {
    const labelSeen = allReads.some(text => labels[key].test(fold(text)) ||
      (key === 'birth_name_absent'
        ? hasPrintedLabel(text, 'birth_pair') || hasPrintedLabel(text, 'birth_last_name') || hasPrintedLabel(text, 'birth_first_name')
        : hasPrintedLabel(text, 'mother_name')));
    if ((suggestions[key] || photoPageRead) && !labelSeen &&
        absenceGroupEmpty(optical, key) && extracted.every(read => absenceGroupEmpty(read, key))) {
      defaults[key] = true;
    }
  }
  return defaults;
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
