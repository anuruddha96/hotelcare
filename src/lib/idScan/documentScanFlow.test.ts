import { describe, expect, it } from 'vitest';
import { readMrz } from './mrz';
import { nextMrzScanAction } from './documentScanFlow';

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
