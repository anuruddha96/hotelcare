import { describe, expect, it } from 'vitest';
import { assessPreview, completeAutoMrz, readableAutoFront } from './autoCapture';
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

describe('live document capture', () => {
  it('waits for stability, contrast and exposure', () => {
    const sharp = Uint8Array.from({ length: 96 * 60 }, (_, i) => i % 4 < 2 ? 70 : 210);
    const moving = Uint8Array.from(sharp, v => 280 - v);
    const blurred = new Uint8Array(sharp.length).fill(140);
    const dark = new Uint8Array(sharp.length).fill(5);
    const overexposed = new Uint8Array(sharp.length).fill(255);
    expect(assessPreview(sharp, null, 96)).toBe(false);
    expect(assessPreview(sharp, sharp, 96)).toBe(true);
    expect(assessPreview(sharp, moving, 96)).toBe(false);
    expect(assessPreview(blurred, blurred, 96)).toBe(false);
    expect(assessPreview(dark, dark, 96)).toBe(false);
    expect(assessPreview(overexposed, overexposed, 96)).toBe(false);
  });
  it('only auto-accepts complete and valid MRZ data on the intended side', () => {
    expect(completeAutoMrz(passport, 'front')).toBe(true);
    expect(completeAutoMrz(passport, 'mrz')).toBe(false);
    expect(completeAutoMrz(null, 'front')).toBe(false);
    expect(completeAutoMrz({ ...passport, valid: false }, 'front')).toBe(false);
    expect(completeAutoMrz({ ...passport, unknownCountry: true }, 'front')).toBe(false);
    expect(completeAutoMrz({ ...passport, fields: { ...passport.fields, dateOfBirth: null } }, 'front')).toBe(false);
    const id: MrzReadResult = { ...passport, format: 'TD1', fields: { ...passport.fields, documentType: 'id_card' } };
    expect(completeAutoMrz(id, 'front')).toBe(false);
    expect(completeAutoMrz(id, 'mrz')).toBe(true);
  });
  it('requires substantial printed ID text, not only a heading or low confidence', () => {
    const front = 'IDENTITY CARD\nFAMILY NAME EXAMPLE\nGIVEN NAME JANE\nDOCUMENT NUMBER AB123456\nDATE OF BIRTH 01 JAN 1990';
    expect(readableAutoFront(front, 85)).toBe(true);
    expect(readableAutoFront(front, 30)).toBe(false);
    expect(readableAutoFront('IDENTITY CARD', 99)).toBe(false);
    expect(readableAutoFront(front.replace('IDENTITY CARD', 'LIBRARY CARD'), 99)).toBe(false);
  });
});
