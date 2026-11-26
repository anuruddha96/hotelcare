import { describe, expect, it } from 'vitest';
import { agreePrinted, capitalValue, parsePrintedText, printedGuestFields } from './printedFields';

const clean = `Születési hely/Place of birth:
DEBRECEN (HUN)
Születési családi és utónév/Family name and Given name at birth:
KISS ROZÁLIA
Anyja születési neve/Mother's maiden name:
KALCSÓ IRMA
Kiállító hatóság /Issuing authority:
BM`;

describe('printed ID fields', () => {
  it('reads the three labelled values and stops at the issuing authority', () => {
    expect(parsePrintedText(clean, true)).toEqual({ birth_place: 'DEBRECEN', birth_name: 'KISS ROZÁLIA', mother_name: 'KALCSÓ IRMA' });
  });
  it('drops stray marks after a value and survives misread labels', () => {
    const noisy = `Szóletési hely Place of beth:\nDEBRECEN (HUN)\nSzületési családi és wonewFamiy name and Given name at bisth\nKISS ROZÁLIA\nAuyja szúletési neve Mother's marden name: ;\nKALCSÓ IRMA Vad\nKiállító ! way`;
    expect(parsePrintedText(noisy, true)).toEqual({ birth_place: 'DEBRECEN', birth_name: 'KISS ROZÁLIA', mother_name: 'KALCSÓ IRMA' });
    expect(capitalValue('KALCSÓ IRMA 5 9.')).toBe('KALCSÓ IRMA');
    expect(capitalValue('Kiállító hatóság')).toBeNull();
  });
  it('uses the Hungarian row order only on that layout', () => {
    const unlabeled = 'dt Pla of bwth\nDEBRECEN (HUN)\nxx yy zz\nKISS ROZÁLIA\nqq\nKALCSÓ IRMA';
    expect(parsePrintedText(unlabeled, true).mother_name).toBe('KALCSÓ IRMA');
    expect(parsePrintedText(unlabeled, false).mother_name).toBeUndefined();
  });
  it('does not remove the last three letters of a town', () => {
    expect(parsePrintedText('Születési hely/Place of birth:\nBUDAPEST', true).birth_place).toBe('BUDAPEST');
    expect(parsePrintedText('Geburtsort/Place of birth\nMÜNCHEN', false).birth_place).toBe('MÜNCHEN');
  });
  it('proposes a value only when two readings agree', () => {
    const a = { birth_place: 'DEBRECEN', birth_name: 'KISS ROZÁLIA', mother_name: 'KALCSÓ IRMA' };
    const b = { birth_place: 'DEBRECEN', birth_name: 'KISS ROZAÁLA', mother_name: 'KALCSO IRMA' };
    const c = { birth_name: 'KISS ROZÁLIA', mother_name: 'KALCSÓ IRMA' };
    expect(agreePrinted([a, b])).toEqual({ birth_place: 'DEBRECEN', mother_name: 'KALCSÓ IRMA' });
    expect(agreePrinted([a, b, c])).toEqual(a);
    expect(agreePrinted([a])).toEqual({});
    // stray capitals after the value, and an accent only one reading caught
    expect(agreePrinted([{ birth_name: 'KISS ROZALIA JÉ' }, { birth_name: 'KISS ROZÁLIA' }, { birth_name: 'KISS ROZALIA TÉL' }])).toEqual({ birth_name: 'KISS ROZÁLIA' });
  });
  it('splits the birth name and rejects a near-miss of the code-line given name', () => {
    expect(printedGuestFields({ birth_name: 'KISS ROZÁLIA', birth_place: 'DEBRECEN', mother_name: 'KALCSÓ IRMA' }, 'ROZALIA'))
      .toEqual({ birth_last_name: 'Kiss', birth_first_name: 'Rozália', birth_place: 'Debrecen', mother_name: 'Kalcsó Irma' });
    expect(printedGuestFields({ birth_name: 'KISS ROZÁLA' }, 'ROZALIA')).toEqual({});
    expect(printedGuestFields({ birth_name: 'NAGY KOVÁCS ANNA MÁRIA' }, 'ANNA MARIA'))
      .toEqual({ birth_last_name: 'Nagy Kovács', birth_first_name: 'Anna Mária' });
  });
});
