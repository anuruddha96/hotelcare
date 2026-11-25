import { describe, expect, it } from 'vitest';
import { assessIdFront, looksLikeIdFront, normalizeVisibleIdText } from './idFront';
import type { MrzGuestFields } from './mrz';

const fields: MrzGuestFields = {
  firstName: 'Rozalia', lastName: 'Szepene Kiss',
  mrzFirstName: 'ROZALIA', mrzLastName: 'SZEPENE KISS',
  nationality: 'HU', nationalityIso3: 'HUN',
  dateOfBirth: '1979-06-30', gender: 'female', documentType: 'id_card',
  documentNumber: '000000XX', expiryDate: '2022-01-10', issuingState: 'HUN',
};

describe('ID card front detection', () => {
  it('recognizes Hungarian identity card front without a manual document-type selection', () => {
    expect(looksLikeIdFront('MAGYARORSZÁG / HUNGARY SZEMÉLYAZONOSÍTÓ IGAZOLVÁNY / IDENTITY CARD')).toBe(true);
  });
  it('rejects random text and passport labels alone', () => {
    expect(looksLikeIdFront('PASSPORT PASSEPORT 123456789')).toBe(false);
    expect(looksLikeIdFront('')).toBe(false);
  });
  it('normalizes accents and harmless spaces for comparison', () => {
    expect(normalizeVisibleIdText('Szépéné Kiss')).toBe('SZEPENEKISS');
    expect(assessIdFront('SZÉPÉNÉ KISS ROZÁLIA 000000XX', fields)).toEqual({
      status: 'matched', matchedFields: ['name', 'document_number'],
    });
  });
  it('never calls an unrelated front verified, even when OCR sees other text', () => {
    expect(assessIdFront('JOHN SMITH AB123456 IDENTITY CARD', fields)).toEqual({
      status: 'needs_review', matchedFields: [],
    });
  });
  it('requires a manual document check when only one field matches', () => {
    expect(assessIdFront('IDENTITY CARD ROZALIA SZEPENE KISS', fields)).toEqual({
      status: 'needs_review', matchedFields: ['name'],
    });
    expect(assessIdFront('blur', fields).status).toBe('unreadable');
  });
});
