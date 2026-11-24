import { describe, expect, it } from 'vitest';
import { documentNumberReview, printedHungarianIdNumber, sameRead, scanConfidence } from './scanReview';
import type { MrzReadResult } from './mrz';

const synthetic: MrzReadResult = {
  format: 'TD1', valid: false, unknownCountry: true,
  lines: ['I<HLUN123456AB<<<<<<<<<<<<<<<<<', 'SYNTHETIC', 'EXAMPLE<<JANE'],
  fields: {
    firstName: 'Jane', lastName: 'Example', mrzFirstName: 'JANE', mrzLastName: 'EXAMPLE',
    nationality: 'HU', nationalityIso3: 'HUN', dateOfBirth: '1990-01-01',
    gender: 'female', documentType: 'id_card', documentNumber: 'N123456AB',
    expiryDate: '2030-01-01', issuingState: 'HLU',
  },
};
describe('scan review accuracy', () => {
  it('suggests independently read printed number without modifying the original MRZ', () => {
    const lines = [...synthetic.lines];
    expect(documentNumberReview(synthetic, 'DOCUMENT NO.\n123456AB\nCAN 012345')).toEqual({ needsReview: true, printed: '123456AB' });
    expect(synthetic.lines).toEqual(lines);
    expect(synthetic.fields.documentNumber).toBe('N123456AB');
  });
  it('never guesses a correction or removes a legitimate N prefix', () => {
    expect(documentNumberReview(synthetic, '')).toEqual({ needsReview: true, printed: null });
    const good: MrzReadResult = { ...synthetic, valid: true, unknownCountry: false, fields: { ...synthetic.fields, issuingState: 'HUN' } };
    expect(documentNumberReview(good, '')).toEqual({ needsReview: false, printed: null });
    expect(printedHungarianIdNumber('CAN 123456AB')).toBeNull();
    expect(printedHungarianIdNumber('DOCUMENT NUMBER 123456AB\nDOCUMENT NO 654321CD')).toBeNull();
  });
  it('uses actual OCR scores without manufacturing confidence for readers', () => {
    expect(scanConfidence(83.6)).toBe(84);
    expect(scanConfidence(null)).toBeNull();
    expect(scanConfidence(NaN)).toBeNull();
  });
  it('recognizes repeated identical reads, not different candidates', () => {
    expect(sameRead(synthetic, { ...synthetic, lines: [...synthetic.lines] })).toBe(true);
    expect(sameRead(synthetic, { ...synthetic, lines: ['OTHER'] })).toBe(false);
    expect(sameRead(null, synthetic)).toBe(false);
  });
});
