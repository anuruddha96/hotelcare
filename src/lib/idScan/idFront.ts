import type { MrzGuestFields } from './mrz';

/**
 * The ID front is an extra, on-device visual cross-check, NOT a second MRZ.
 * Its imperfect OCR must never overwrite the frozen machine-readable VIZA data.
 * No image or front-side OCR text is persisted.
 */
export type IdFrontAssessment = {
  status: 'matched' | 'needs_review' | 'unreadable';
  matchedFields: Array<'name' | 'document_number'>;
};

export function normalizeVisibleIdText(text: string): string {
  return String(text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Conservative classification for the common case of scanning an ID front first. */
export function looksLikeIdFront(text: string): boolean {
  const normal = normalizeVisibleIdText(text);
  if (normal.length < 25) return false;
  return [
    'IDENTITYCARD', 'SZEMELYAZONOSITOIGAZOLVANY',
    'PERSONALAUSWEIS', 'CARTEIDENTITE', 'CARTADIDENTITA',
    'DOCUMENTODEIDENTIDAD', 'DOWODOSOBISTY',
    'IDENTITYDOCUMENT', 'NATIONALIDENTITY',
  ].some((marker) => normal.includes(marker));
}

/** Positive matching needs the legal name AND the document number on the front. */
export function assessIdFront(text: string, fields: MrzGuestFields): IdFrontAssessment {
  const normal = normalizeVisibleIdText(text);
  if (normal.length < 14) return { status: 'unreadable', matchedFields: [] };
  const number = normalizeVisibleIdText(fields.documentNumber);
  const numberMatched = number.length >= 5 && normal.includes(number);
  const lastName = normalizeVisibleIdText(fields.mrzLastName);
  const firstName = normalizeVisibleIdText(fields.mrzFirstName);
  const namesMatched = lastName.length >= 3 && firstName.length >= 2
    && normal.includes(lastName) && normal.includes(firstName);
  const matchedFields: IdFrontAssessment['matchedFields'] = [];
  if (namesMatched) matchedFields.push('name');
  if (numberMatched) matchedFields.push('document_number');
  return { status: numberMatched && namesMatched ? 'matched' : 'needs_review', matchedFields };
}
