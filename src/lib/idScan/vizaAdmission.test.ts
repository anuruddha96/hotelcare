import { describe, expect, it } from 'vitest';
import { documentRequired, vizaAdmissionFields, vizaArrivalDay, type GuestVizaValues } from './guestVizaChecks';
import { guestToVizaGroups } from '../../../supabase/functions/_shared/viza/mapGuest';

const stay = 'test-stay';
const day = new Date('2026-11-24T00:00:00Z');
const base: GuestVizaValues = {
  first_name: 'Test', last_name: 'Guest', nationality: 'HU', gender: 'female',
  date_of_birth: '1990-01-01', id_document_type: 'id_card', id_document_number: 'TEST123',
  birth_first_name: 'Test', birth_last_name: 'Guest', birth_place: 'Budapest',
  mother_family_name: 'Compound Family', mother_given_name: 'Given',
  viza_review: { reservation_id: stay, manual_reason: 'Scanner failed' },
};
const check = (g: GuestVizaValues) => vizaAdmissionFields(g, stay, day);

describe('document-aware VIZA admission', () => {
  it('requires all Hungarian ID birth fields despite absence flags', () => {
    expect(check(base)).toEqual([]);
    expect(check({ ...base, mother_given_name: null, birth_place: null, birth_first_name: null,
      viza_review: { reservation_id: stay, manual_reason: 'Scanner failed', mother_name_absent: true, birth_place_absent: true, birth_name_absent: true },
    })).toEqual(expect.arrayContaining(['mother_given_name', 'birth_place', 'birth_first_name']));
  });
  it('allows foreign passport fields absent only when explicitly confirmed for this stay', () => {
    const guest: GuestVizaValues = { ...base, nationality: 'DE', id_document_type: 'passport',
      mother_family_name: null, mother_given_name: null, birth_place: null,
      birth_first_name: null, birth_last_name: null,
      viza_review: { reservation_id: stay, manual_reason: 'Scanner failed', mother_name_absent: true, birth_place_absent: true, birth_name_absent: true },
    };
    expect(check(guest)).toEqual([]);
    expect(check({ ...guest, viza_review: { ...guest.viza_review, reservation_id: 'old-stay' } })).toEqual(expect.arrayContaining(['mother_family_name','birth_place','birth_last_name','manual_reason']));
  });
  it('requires both halves even when an absence checkbox is selected', () => {
    expect(check({ ...base, nationality: 'DE', id_document_type: 'passport', mother_given_name: null,
      viza_review: { ...base.viza_review, mother_name_absent: true } })).toContain('mother_given_name');
  });
  it('requires entry and visa/permit information outside the EEA and Switzerland', () => {
    const guest = { ...base, nationality: 'LK' };
    expect(check(guest)).toEqual(expect.arrayContaining(['entry_date','entry_place','visa_number']));
    expect(check({ ...guest, entry_date: '2026-11-22', entry_place: 'Vienna',
      viza_review: { ...guest.viza_review, visa_exempt: true } })).toEqual([]);
    expect(check({ ...base, nationality: 'CH' })).toEqual([]);
  });
  it('allows reviewed unavailable entry details without bypassing invalid supplied values', () => {
    const guest: GuestVizaValues = { ...base, nationality: 'GB', id_document_type: 'passport',
      birth_first_name: null, birth_last_name: null, mother_family_name: null, mother_given_name: null,
      birth_place: 'Gibraltar', viza_review: { reservation_id: stay, scan_reviewed: true, birth_name_absent: true, mother_name_absent: true, visa_exempt: true, entry_details_absent: true },
    };
    expect(check(guest)).toEqual([]);
    expect(check({ ...guest, entry_date: '2026-11-25' })).toContain('entry_date');
    expect(check({ ...guest, entry_date: '2026-02-30' })).toContain('entry_date');
    expect(check({ ...guest, entry_place: 'ő'.repeat(128) })).toContain('entry_place');
    expect(check({ ...guest, viza_review: { ...guest.viza_review, reservation_id: 'old-stay' } })).toEqual(expect.arrayContaining(['entry_date', 'entry_place', 'visa_number']));
    expect(check({ ...guest, birth_place: null })).toContain('birth_place');
    expect(check({ ...guest, viza_review: { ...guest.viza_review, visa_exempt: false } })).toContain('visa_number');
  });
  it('uses the actual arrival day at the fourteenth birthday', () => {
    expect(documentRequired('2012-11-24', day)).toBe(true);
    expect(documentRequired('2012-11-25', day)).toBe(false);
    expect(vizaArrivalDay('2026-11-23T23:30:00Z').toISOString()).toBe(day.toISOString());
    const child = { ...base, date_of_birth: '2012-11-25', id_document_number: null, id_document_type: null };
    expect(check(child)).toContain('parent_statement');
    expect(check({ ...child, viza_review: { reservation_id: stay, parent_statement: true } })).toEqual([]);
    expect(check({ ...child, date_of_birth: '2012-11-24' })).toContain('id_document_number');
  });
  it('rejects impossible dates, unrecognized countries, and overlong UTF-8 names', () => {
    expect(check({ ...base, date_of_birth: '1990-02-30', nationality: 'ZZ', last_name: 'ő'.repeat(128) }))
      .toEqual(expect.arrayContaining(['date_of_birth','nationality','last_name']));
  });
  it('requires a current scan review or manual-entry reason', () => {
    expect(check({ ...base, viza_review: { reservation_id: stay } })).toContain('manual_reason');
  });
});

describe('VIZA name pair mapping', () => {
  it('preserves raw scan and sends both names when one is corrected', () => {
    const scan = { csaladnev: 'GYORI', utonev: 'TUNDE', anyjaCsaladnev: 'COMPOUND FAMILY', anyjaUtonev: 'GIVEN' };
    const groups = guestToVizaGroups({ ...base, last_name: 'Győri', first_name: 'Tunde',
      mother_family_name: 'Compound Fámily', mother_given_name: 'Given', document_scan: { fields: scan } });
    expect(groups.scanned).toEqual(scan);
    expect(groups.manual).toMatchObject({ csaladnev: 'Győri', utonev: 'Tunde', anyjaCsaladnev: 'Compound Fámily', anyjaUtonev: 'Given' });
  });
});
