import { describe, expect, it } from 'vitest';
import { readMrz } from './mrz';
import { firstSideAction, nextMrzScanAction } from './documentScanFlow';

// ICAO specimen passport and ID card. The classification comes from the
// machine-readable code, not the receptionist's selection or a guessed shape.
const passport = readMrz([
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
].join('\n'))!;
const idCard = readMrz([
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
].join('\n'))!;

describe('reception document scan order', () => {
  it('identifies passport from its single bio-page MRZ, without a type selector or a second scan', () => {
    expect(passport.fields.documentType).toBe('passport');
    expect(passport.format).toBe('TD3');
    expect(nextMrzScanAction(passport, false)).toBe('passport_complete');
  });
  it('refuses an ID back scanned before its front', () => {
    expect(idCard.fields.documentType).toBe('id_card');
    expect(nextMrzScanAction(idCard, false)).toBe('front_first_required');
  });
  it('requests no additional side after ID front then back', () => {
    expect(nextMrzScanAction(idCard, true)).toBe('id_complete');
  });
  it('never merges the front of an ID with another passport bio page', () => {
    expect(nextMrzScanAction(passport, true)).toBe('different_document');
  });
});

describe('first side decision table', () => {
  const validPassport = { ...passport, valid: true, unknownCountry: false };
  const validId = { ...idCard, valid: true, unknownCountry: false };
  it('routes valid passport and wrong-side ID independently of quality', () => {
    expect(firstSideAction(validPassport, false)).toBe('passport_complete');
    expect(firstSideAction(validId, true)).toBe('front_first_required');
    expect(firstSideAction(validId, false)).toBe('front_first_required');
  });
  it('does not require a heading or OCR text on a sharp first side', () => {
    expect(firstSideAction(null, true)).toBe('provisional_front');
    expect(firstSideAction({ ...validPassport, valid: false }, true)).toBe('provisional_front');
    expect(firstSideAction(null, false)).toBe('retry');
    expect(firstSideAction({ ...validId, valid: false }, false)).toBe('retry');
  });
  it('recovers a passport from provisional front but not positive ID evidence', () => {
    expect(nextMrzScanAction(validPassport, true, false)).toBe('passport_complete');
    expect(nextMrzScanAction(validPassport, true, true)).toBe('different_document');
    expect(nextMrzScanAction(validId, true, false)).toBe('id_complete');
    expect(nextMrzScanAction(validId, false, false)).toBe('front_first_required');
  });
});
