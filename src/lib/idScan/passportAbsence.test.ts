import { describe, it, expect } from 'vitest';
import type { MrzReadResult } from './mrz';
import { passportAbsenceReview, suggestPassportAbsences } from './passportAbsence';

const passport: MrzReadResult = {
  format:'TD3', valid:true, unknownCountry:false, lines:[],
  fields:{firstName:'Eva',lastName:'Example',mrzFirstName:'EVA',mrzLastName:'EXAMPLE', nationality:'DE',nationalityIso3:'DEU',
    dateOfBirth:'1990-01-01',gender:'female',documentType:'passport',documentNumber:'TEST123',expiryDate:'2030-01-01',issuingState:'DEU'},
};
const visual = 'Surname\nEXAMPLE\nGiven names\nEVA\nDate of birth\n01 JAN 1990\nNationality\nDEU';
const all = {birth_name_absent:true,mother_name_absent:true,birth_place_absent:true} as const;
describe('passport printed-field suggestions',()=>{
  it('suggests all three missing groups on two readable photo-page passes',()=>{
    expect(suggestPassportAbsences(passport,{},[visual,visual],92)).toEqual(all);
  });
  it('does not suggest birthplace when printed but unreadable, even in another language',()=>{
    expect(suggestPassportAbsences(passport,{},[visual,visual+'\nGeburtsort'],92)).toEqual({birth_name_absent:true,mother_name_absent:true});
    expect(suggestPassportAbsences(passport,{birth_place:'Berlin'},[visual,visual],92)).not.toHaveProperty('birth_place_absent');
    expect(suggestPassportAbsences(passport,{},[visual+'\nPlace of birth\nBERLIN',visual+'\nPlace of birth\nHAMBURG'],92)).not.toHaveProperty('birth_place_absent');
  });
  it('does not offer missing groups when only the MRZ was read, the scan failed, or the document is an ID',()=>{
    expect(suggestPassportAbsences(passport,{},[],null)).toEqual({});
    expect(suggestPassportAbsences(passport,{},[visual,visual],55)).toEqual({});
    expect(suggestPassportAbsences(passport,{},[visual],95)).toEqual({});
    expect(suggestPassportAbsences(passport,{},['P<DEUEXAMPLE<<EVA','P<DEUEXAMPLE<<EVA'],99)).toEqual({});
    expect(suggestPassportAbsences({...passport,valid:false},{},[visual,visual],99)).toEqual({});
    expect(suggestPassportAbsences({...passport,format:'TD1',fields:{...passport.fields,documentType:'id_card'}},{},[visual,visual],99)).toEqual({});
  });
  it('persists only explicitly confirmed proposals, preserves existing values and clears contradictory flags',()=>{
    expect(passportAbsenceReview({},passport)).toEqual({});
    expect(passportAbsenceReview({},passport,all)).toEqual(all);
    expect(passportAbsenceReview({birth_place:'Berlin',mother_name:'Example Anna',birth_last_name:'Example'},passport,all)).toEqual({birth_name_absent:false,mother_name_absent:false,birth_place_absent:false});
    expect(passportAbsenceReview({}, {...passport,valid:false}, all)).toEqual({});
  });
});
