import { describe, expect, it } from 'vitest';
import { extractMrzLines, mrzDate, normalizeMrzLine, readMrz } from './mrz';

// ICAO Doc 9303 specimen documents (fictional "Utopia", Anna Maria Eriksson).
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];
const TD1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
];
const TODAY = new Date('2026-11-14T10:00:00Z');

describe('readMrz', () => {
  it('reads a passport (TD3) with valid check digits', () => {
    const r = readMrz(TD3.join('\n'), TODAY);
    expect(r?.format).toBe('TD3');
    expect(r?.valid).toBe(true);
    expect(r?.fields).toMatchObject({
      firstName: 'Anna Maria', lastName: 'Eriksson', nationality: 'UTO',
      dateOfBirth: '1974-08-12', gender: 'female', documentType: 'passport',
      documentNumber: 'L898902C3', expiryDate: '2012-04-15', issuingState: 'UTO',
    });
  });

  it('reads an ID card (TD1)', () => {
    const r = readMrz(TD1.join('\n'), TODAY);
    expect(r?.format).toBe('TD1');
    expect(r?.valid).toBe(true);
    expect(r?.fields.documentType).toBe('id_card');
    expect(r?.fields.documentNumber).toBe('D23145890');
    expect(r?.fields.lastName).toBe('Eriksson');
  });

  it('ignores other printed text and tolerates OCR spacing and «', () => {
    const noisy = [
      'PASSPORT  PASSEPORT',
      'Surname / Nom  ERIKSSON',
      'P < UTOERIKSSON««ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
    ].join('\n');
    const r = readMrz(noisy, TODAY);
    expect(r?.fields.firstName).toBe('Anna Maria');
    expect(r?.valid).toBe(true);
  });

  it('flags a misread digit as not valid so staff must check', () => {
    const tampered = [TD3[0], TD3[1].replace('7408122', '7408123')].join('\n');
    const r = readMrz(tampered, TODAY);
    expect(r).not.toBeNull();
    expect(r?.valid).toBe(false);
  });

  it('returns null when there is no MRZ', () => {
    expect(readMrz('Just a photo of a room\nnothing here', TODAY)).toBeNull();
  });
});

describe('helpers', () => {
  it('normalizes OCR lines', () => {
    expect(normalizeMrzLine(' p<uto eriksson« ')).toBe('P<UTOERIKSSON<');
  });

  it('pads or trims near-length lines', () => {
    const r = extractMrzLines([TD3[0].slice(0, 43), TD3[1] + '<'].join('\n'));
    expect(r?.lines.map((l) => l.length)).toEqual([44, 44]);
  });

  it('infers centuries sensibly', () => {
    expect(mrzDate('850101', 'birth', TODAY)).toBe('1985-01-01');
    expect(mrzDate('100101', 'birth', TODAY)).toBe('2010-01-01');
    expect(mrzDate('300101', 'expiry', TODAY)).toBe('2030-01-01');
    expect(mrzDate('991301', 'birth', TODAY)).toBeNull();
  });
});
