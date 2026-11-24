import { describe, expect, it } from 'vitest';
import { extractOpticalGuestFields, guestScanPatch, opticalGuestFields } from './opticalGuestFields';
import { toVizaDocumentScan } from './vizaScan';
import type { MrzReadResult } from './mrz';

const sample: MrzReadResult = {
  format: 'TD1', valid: false, unknownCountry: true, lines: ['SYNTHETIC'],
  fields: {
    firstName: 'Eva', lastName: 'Example', mrzFirstName: 'EVA', mrzLastName: 'EXAMPLE',
    nationality: 'HU', nationalityIso3: 'HUN', dateOfBirth: '1990-01-01',
    gender: 'female', documentType: 'id_card', documentNumber: 'N123456AB',
    expiryDate: '2030-01-01', issuingState: 'HLU',
  },
};
describe('printed fields and guest autofill', () => {
  it('fills known nationality even when the issuing-state code failed', () => {
    expect(guestScanPatch(sample).nationality).toBe('HU');
    expect(toVizaDocumentScan(sample).fields.allampolgarsagKod).toBe('HU');
    expect(toVizaDocumentScan(sample).valid).toBe(false);
    const unknown = { ...sample, fields: { ...sample.fields, nationality: 'ZZ', nationalityIso3: 'ZZZ', issuingState: 'HUN' } };
    expect(guestScanPatch(unknown).nationality).toBeUndefined();
    expect(toVizaDocumentScan(unknown).fields.allampolgarsagKod).toBeNull();
  });
  it('extracts explicitly labeled birth names, birthplace and mother name from a second side', () => {
    const text = 'Születési név: Minta Éva\nAnyja születési neve: Példa Anna\nSzületési hely: Budapest';
    expect(opticalGuestFields(sample, '', text)).toEqual({
      birth_last_name: 'Minta', birth_first_name: 'Éva', mother_name: 'Példa Anna', birth_place: 'Budapest',
    });
    expect(extractOpticalGuestFields('Family name at birth: Minta\nGiven name at birth: Éva')).toEqual({ birth_last_name: 'Minta', birth_first_name: 'Éva' });
  });
  it('recognizes a labeled printed document number while retaining the unchanged MRZ result', () => {
    const fields = opticalGuestFields(sample, 'Okmányazonosító / Doc. No.\n123456AB', '');
    expect(guestScanPatch(sample, fields).id_document_number).toBe('123456AB');
    expect(toVizaDocumentScan(sample).fields.okmanyAzonositoSzam).toBe('N123456AB');
  });
  it('does not invent absent details or split ambiguous birth-name pairs', () => {
    expect(opticalGuestFields(sample, 'HUNGARY\nCAN 012345', '')).toEqual({});
    expect(opticalGuestFields(sample, '', 'Birth name: Minta Eva Anna')).toEqual({});
    expect(opticalGuestFields(sample, '', 'Family name at birth: Minta')).toEqual({});
    expect(opticalGuestFields(sample, 'Place of birth: Budapest', 'Place of birth: Pécs')).toEqual({});
    expect(guestScanPatch(sample).mother_name).toBeUndefined();
    expect(guestScanPatch(sample).birth_place).toBeUndefined();
  });
  it('reads a labeled bilingual passport birthplace beside the sex field', () => {
    expect(extractOpticalGuestFields('Sex/Sexe Place of birth/Lieu de naissance\nM GIBRALTAR\nDate of issue\n24 JAN 07').birth_place).toBe('Gibraltar');
    expect(extractOpticalGuestFields('Sex/Sexe Place of birth/Lieu de naissance\nDate of issue\n24 JAN 07').birth_place).toBeUndefined();
  });
  it('does not replace the MRZ names with an unrelated printed name', () => {
    expect(opticalGuestFields(sample, 'Given name: Anna', '').first_name).toBeUndefined();
    expect(opticalGuestFields(sample, 'Given name: Éva', '').first_name).toBe('Éva');
  });
});

describe('bilingual Hungarian ID back layout', () => {
  it('reads the labeled specimen layout, including parenthesized birthplace country', () => {
    expect(extractOpticalGuestFields([
      'Születési hely / Place of birth:',
      'PÉCS (HUN)',
      'Születési családi és utónév / Family name and Given name at birth:',
      'MINTA ÉVA',
      "Anyja születési neve / Mother's maiden name:",
      'PÉLDA ANNA',
    ].join('\n'))).toEqual({
      birth_place: 'Pécs', birth_last_name: 'Minta', birth_first_name: 'Éva', mother_name: 'Példa Anna',
    });
  });
});
