import { describe, expect, it } from 'vitest';
import { vizaErrorCode, vizaErrorFormField, vizaRejectionReason } from './vizaReason';

const hu: Record<string, string> = {
  'pms.viza.reason.tooLong': '{field}: túl hosszú (legfeljebb {max} karakter). Javítsd az okmány alapján.',
  'pms.viza.reason.missing': '{field}: hiányzik. Pótold az okmány alapján.',
  'pms.viza.reason.invalid': '{field}: hibás. Ellenőrizd az okmány alapján.',
  'pms.viza.reason.stay': 'Az érkezés vagy a távozás idejét a VIZA nem fogadta el.',
  'pms.viza.reason.generic': 'A VIZA nem fogadta el a vendégadatokat.',
  'pms.guest.birthPlace': 'Születési hely',
  'pms.guest.nationality': 'Állampolgárság',
  'pms.guest.motherFamily': 'Anyja születési családi neve',
};
const t = (key: string) => hu[key] ?? key;

describe('VIZA rejection in plain words', () => {
  it('names the field, the limit and what to do', () => {
    const error = 'THF EF0051: Születési hely túl hosszú. (Maximum 200 karakter, maximum 254 bájt (UTF8 kódolással))';
    expect(vizaErrorCode(error)).toBe('EF0051');
    expect(vizaRejectionReason(error, t)).toBe('Születési hely: túl hosszú (legfeljebb 200 karakter). Javítsd az okmány alapján.');
    expect(vizaErrorFormField(error)).toBe('birth_place');
    expect(vizaRejectionReason('THF EF0060: Állampolgárság kód hibás', t)).toBe('Állampolgárság: hibás. Ellenőrizd az okmány alapján.');
    expect(vizaRejectionReason('THF EF0052', t)).toBe('Anyja születési családi neve: hiányzik. Pótold az okmány alapján.');
  });

  it('handles stay-time codes and unknown answers', () => {
    expect(vizaRejectionReason('THF EF0030: Érkezés ideje nem esik elfogadható tartományba', t)).toBe(hu['pms.viza.reason.stay']);
    expect(vizaRejectionReason('THF EF9999: something new', t)).toBe(hu['pms.viza.reason.generic']);
    expect(vizaRejectionReason(null, t)).toBe(hu['pms.viza.reason.generic']);
    expect(vizaErrorFormField('no code')).toBeNull();
  });
});
