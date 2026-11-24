import { describe, expect, it } from 'vitest';
import { documentRequired, vizaAdmissionFields, vizaArrivalDay, vizaFieldRequirements, vizaMissingFields, type GuestVizaValues } from './guestVizaChecks';
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
  it('ignores stale entry values only with a valid reason', () => {
    const guest: GuestVizaValues = { ...base, nationality: 'GB', id_document_type: 'passport',
      birth_first_name: null, birth_last_name: null, mother_family_name: null, mother_given_name: null,
      birth_place: 'Gibraltar', viza_review: { reservation_id: stay, manual_reason: 'Scanner failed', birth_name_absent: true, mother_name_absent: true, visa_exempt: true, entry_details_absent: true, entry_details_reason: 'other', entry_details_reason_text: 'Confirmed reason' },
    };
    expect(check(guest)).toEqual([]);
    expect(check({ ...guest, entry_date: '2026-11-25' })).toEqual([]);
    expect(check({ ...guest, entry_date: '2026-02-30' })).toEqual([]);
    expect(check({ ...guest, entry_place: 'ő'.repeat(128) })).toEqual([]);
    expect(check({ ...guest, viza_review: { ...guest.viza_review, entry_details_reason: undefined } })).toContain('entry_details_reason');
    expect(vizaFieldRequirements(guest, stay, day).entry_place).toMatchObject({state:'not_needed',ok:true});
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

describe('VIZA requirement states and placeholder guard', () => {
  const gb: GuestVizaValues = { ...base, nationality:'GB', id_document_type:'passport',
    birth_first_name:null, birth_last_name:null, mother_family_name:null, mother_given_name:null,
    birth_place:'Gibraltar', visa_number:'0123456789', entry_date:'2026-11-23', entry_place:'Budapest',
    viza_review:{ ...base.viza_review, birth_name_absent:true, mother_name_absent:true } };
  it('accepts specimen case and describes printed-only fields', () => {
    expect(check(gb)).toEqual([]);
    expect(vizaFieldRequirements(gb,stay,day).birth_place).toMatchObject({state:'printed_only',ok:true});
    expect(vizaFieldRequirements({...gb,birth_place:null},stay,day).birth_place).toMatchObject({state:'printed_only',ok:false});
  });
  it('rejects accent-folded placeholders and entry before birth or after arrival', () => {
    expect(check({...gb,entry_place:' NÁ ',birth_place:'000',visa_number:'N/A'})).toEqual(expect.arrayContaining(['entry_place','birth_place','visa_number']));
    expect(check({...gb,entry_date:'2026-11-25'})).toContain('entry_date');
    expect(check({...gb,entry_date:'1980-01-01'})).toContain('entry_date');
  });
  it('requires the permit for the residence reason', () => {
    expect(check({...gb,visa_number:null,viza_review:{...gb.viza_review,visa_exempt:true,entry_details_absent:true,entry_details_reason:'lives_in_hungary_with_permit'}})).toContain('visa_number');
  });
});

describe('VIZA field length messages', () => {
  it.each(['last_name','first_name','birth_last_name','birth_first_name','mother_family_name','mother_given_name','birth_place'] as const)('reports a 200-character or UTF-8 byte violation for %s', field => {
    for (const value of ['A'.repeat(201), 'ő'.repeat(128)]) {
      const requirements = vizaFieldRequirements({...base,[field]:value},stay,day);
      expect(requirements[field]).toMatchObject({ok:false,messageKey:'pms.guest.requirement.tooLong'});
    }
    for (const value of ['A'.repeat(200), 'ő'.repeat(127)]) {
      expect(vizaFieldRequirements({...base,[field]:value},stay,day)[field].ok).toBe(true);
    }
  });
  it('keeps the printed-only and placeholder rules distinct from length failures', () => {
    const passport = {...base,nationality:'DE',id_document_type:'passport'};
    const requirements = (birth_place: string | null) => vizaFieldRequirements({...passport,birth_place},stay,day).birth_place;
    expect(requirements(null)).toMatchObject({ok:false,messageKey:'pms.guest.requirement.printedOnly'});
    expect(requirements('NA')).toMatchObject({ok:false,messageKey:'pms.guest.requirement.placeholder'});
    expect(requirements('A'.repeat(201))).toMatchObject({state:'printed_only',ok:false,messageKey:'pms.guest.requirement.tooLong'});
    expect(vizaMissingFields({...base,birth_place:'ő'.repeat(128)},day)).toContain('birth_place');
    expect(vizaMissingFields({...base,birth_place:'A'.repeat(200)},day)).not.toContain('birth_place');
  });
  it('uses 100 characters for document and visa numbers, and 200/254 for entry place', () => {
    const third = {...base,nationality:'GB',entry_date:'2026-11-23',entry_place:'Budapest',visa_number:'VISA'};
    const requirements = vizaFieldRequirements({...third,id_document_number:'A'.repeat(101),visa_number:'B'.repeat(101),entry_place:'ő'.repeat(128)},stay,day);
    expect(requirements.id_document_number).toMatchObject({ok:false,messageKey:'pms.guest.requirement.tooLong100'});
    expect(requirements.visa_number).toMatchObject({ok:false,messageKey:'pms.guest.requirement.tooLong100'});
    expect(requirements.entry_place).toMatchObject({ok:false,messageKey:'pms.guest.requirement.tooLong'});
    expect(vizaFieldRequirements({...third,id_document_number:'A'.repeat(100),visa_number:'B'.repeat(100),entry_place:'ő'.repeat(127)},stay,day).visa_number.ok).toBe(true);
    expect(vizaFieldRequirements({...base,visa_number:'A'.repeat(101),entry_place:'ő'.repeat(128)},stay,day).entry_place).toMatchObject({ok:true,messageKey:'pms.guest.requirement.notNeeded'});
  });
});
