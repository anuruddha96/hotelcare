/**
 * THF rejection codes (interface guide v700, chapter 6) in plain words for reception:
 * which field, and what to do. The original THF code and text stay visible separately.
 */

type Kind = 'missing' | 'tooLong' | 'invalid';
interface Rule { field: string; kind: Kind; max?: number }

const FAMILY = 'pms.guest.familyName';
const GIVEN = 'pms.guest.givenName';
const BIRTH_FAMILY = 'pms.guest.birthFamilyName';
const BIRTH_GIVEN = 'pms.guest.birthGivenName';
const BIRTH_DATE = 'pms.guest.birthDate';
const BIRTH_PLACE = 'pms.guest.birthPlace';
const MOTHER_FAMILY = 'pms.guest.motherFamily';
const MOTHER_GIVEN = 'pms.guest.motherGiven';
const NATIONALITY = 'pms.guest.nationality';
const GENDER = 'pms.guest.gender';
const DOC_TYPE = 'pms.guest.docType';
const DOC_NUMBER = 'pms.guest.docNumber';
const VISA = 'pms.guest.visaNumber';
const ENTRY_DATE = 'pms.guest.entryDate';
const ENTRY_PLACE = 'pms.guest.entryPlace';

const RULES: Record<string, Rule> = {
  EF0034: { field: FAMILY, kind: 'missing' }, EF0035: { field: FAMILY, kind: 'tooLong', max: 200 }, EF0101: { field: FAMILY, kind: 'tooLong', max: 200 },
  EF0036: { field: GIVEN, kind: 'missing' }, EF0037: { field: GIVEN, kind: 'tooLong', max: 200 }, EF0102: { field: GIVEN, kind: 'tooLong', max: 200 },
  EF0039: { field: BIRTH_FAMILY, kind: 'missing' }, EF0040: { field: BIRTH_FAMILY, kind: 'tooLong', max: 200 }, EF0103: { field: BIRTH_FAMILY, kind: 'tooLong', max: 200 },
  EF0041: { field: BIRTH_GIVEN, kind: 'missing' }, EF0042: { field: BIRTH_GIVEN, kind: 'tooLong', max: 200 }, EF0104: { field: BIRTH_GIVEN, kind: 'tooLong', max: 200 },
  EF0047: { field: BIRTH_DATE, kind: 'invalid' }, EF0048: { field: BIRTH_DATE, kind: 'invalid' }, EF0105: { field: BIRTH_DATE, kind: 'invalid' }, EF0106: { field: BIRTH_DATE, kind: 'invalid' },
  EF0051: { field: BIRTH_PLACE, kind: 'tooLong', max: 200 }, EF0107: { field: BIRTH_PLACE, kind: 'tooLong', max: 200 },
  EF0052: { field: MOTHER_FAMILY, kind: 'missing' }, EF0053: { field: MOTHER_FAMILY, kind: 'tooLong', max: 200 }, EF0108: { field: MOTHER_FAMILY, kind: 'tooLong', max: 200 },
  EF0054: { field: MOTHER_GIVEN, kind: 'missing' }, EF0055: { field: MOTHER_GIVEN, kind: 'tooLong', max: 200 }, EF0109: { field: MOTHER_GIVEN, kind: 'tooLong', max: 200 },
  EF0059: { field: NATIONALITY, kind: 'missing' }, EF0060: { field: NATIONALITY, kind: 'invalid' }, EF0110: { field: NATIONALITY, kind: 'invalid' },
  EF0061: { field: GENDER, kind: 'missing' }, EF0062: { field: GENDER, kind: 'invalid' }, EF0111: { field: GENDER, kind: 'invalid' },
  EF0063: { field: DOC_TYPE, kind: 'missing' }, EF0064: { field: DOC_TYPE, kind: 'invalid' }, EF0112: { field: DOC_TYPE, kind: 'invalid' },
  EF0065: { field: DOC_NUMBER, kind: 'missing' }, EF0067: { field: DOC_NUMBER, kind: 'tooLong', max: 100 }, EF0113: { field: DOC_NUMBER, kind: 'tooLong', max: 100 },
  EF0069: { field: VISA, kind: 'tooLong', max: 100 },
  EF0072: { field: ENTRY_DATE, kind: 'invalid' },
  EF0075: { field: ENTRY_PLACE, kind: 'tooLong', max: 200 },
};

/** Arrival / departure time problems: about the stay, not the document. */
const STAY_CODES = new Set(['EF0029', 'EF0030', 'EF0032', 'EF0033', 'EF0088', 'EF0089']);

/** "THF EF0051: Születési hely túl hosszú…" → "EF0051". */
export function vizaErrorCode(lastError: string | null | undefined): string | null {
  return /\b(EF\d{4})\b/.exec(String(lastError ?? ''))?.[1] ?? null;
}

const FORM_FIELD: Record<string, string> = {
  [FAMILY]: 'last_name', [GIVEN]: 'first_name', [BIRTH_FAMILY]: 'birth_last_name', [BIRTH_GIVEN]: 'birth_first_name',
  [BIRTH_DATE]: 'date_of_birth', [BIRTH_PLACE]: 'birth_place', [MOTHER_FAMILY]: 'mother_family_name', [MOTHER_GIVEN]: 'mother_given_name',
  [NATIONALITY]: 'nationality', [GENDER]: 'gender', [DOC_TYPE]: 'id_document_type', [DOC_NUMBER]: 'id_document_number',
  [VISA]: 'visa_number', [ENTRY_DATE]: 'entry_date', [ENTRY_PLACE]: 'entry_place',
};

/** The guest form field the THF complained about (its data-viza-field name), so the form can jump to it. */
export function vizaErrorFormField(lastError: string | null | undefined): string | null {
  const code = vizaErrorCode(lastError);
  const rule = code ? RULES[code] : undefined;
  return rule ? FORM_FIELD[rule.field] ?? null : null;
}

export function vizaRejectionReason(lastError: string | null | undefined, t: (key: string) => string): string {
  const code = vizaErrorCode(lastError);
  if (code && STAY_CODES.has(code)) return t('pms.viza.reason.stay');
  const rule = code ? RULES[code] : undefined;
  if (!rule) return t('pms.viza.reason.generic');
  return t(`pms.viza.reason.${rule.kind}`)
    .replace('{field}', t(rule.field))
    .replace('{max}', String(rule.max ?? ''));
}
