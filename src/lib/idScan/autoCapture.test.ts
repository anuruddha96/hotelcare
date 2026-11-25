import { describe, expect, it } from 'vitest';
import { assessReadiness, completeAutoMrz } from './autoCapture';
import type { MrzReadResult } from './mrz';

const passport: MrzReadResult = {
  format: 'TD3', valid: true, unknownCountry: false, lines: [],
  fields: {
    firstName: 'Jane', lastName: 'Example', mrzFirstName: 'JANE', mrzLastName: 'EXAMPLE',
    nationality: 'HU', nationalityIso3: 'HUN', dateOfBirth: '1990-01-01',
    gender: 'female', documentType: 'passport', documentNumber: 'AB123456',
    expiryDate: '2030-01-01', issuingState: 'HUN',
  },
};

describe('guide crop readiness', () => {
  const width = 320;
  const n = width * 200;
  const sharp = Uint8Array.from({ length: n }, (_, i) => (i % width) % 8 < 4 ? 80 : 200);
  const moving = Uint8Array.from(sharp, v => 280 - v);
  const smooth = Uint8Array.from({ length: n }, (_, i) => 140 + Math.round(35 * Math.sin((i % width) / 30)));
  const flat = new Uint8Array(n).fill(140);
  it('accepts a sharp well-exposed crop and rejects motion or lack of previous sample', () => {
    expect(assessReadiness(sharp, width, sharp)).toBe('ready');
    expect(assessReadiness(sharp, width, moving)).toBe('holdSteady');
    expect(assessReadiness(sharp, width)).toBe('holdSteady');
    expect(assessReadiness(sharp, width, null, false)).toBe('ready');
  });
  it('provides actionable exposure and focus guidance', () => {
    expect(assessReadiness(smooth, width, smooth)).toBe('moveCloser');
    expect(assessReadiness(flat, width, flat)).toBe('moveCloser');
    expect(assessReadiness(new Uint8Array(n).fill(5), width)).toBe('tooDark');
    expect(assessReadiness(new Uint8Array(n).fill(255), width)).toBe('tooMuchGlare');
    expect(assessReadiness(new Uint8Array(0), width)).toBe('moveCloser');
  });
  it('accepts only complete, valid, consistent MRZ data; side routing is separate', () => {
    expect(completeAutoMrz(passport)).toBe(true);
    expect(completeAutoMrz(null)).toBe(false);
    expect(completeAutoMrz({ ...passport, valid: false })).toBe(false);
    expect(completeAutoMrz({ ...passport, unknownCountry: true })).toBe(false);
    expect(completeAutoMrz({ ...passport, fields: { ...passport.fields, dateOfBirth: null } })).toBe(false);
    expect(completeAutoMrz({ ...passport, format: 'TD1' })).toBe(false);
    expect(completeAutoMrz({ ...passport, format: 'TD1', fields: { ...passport.fields, documentType: 'id_card' } })).toBe(true);
  });
});
