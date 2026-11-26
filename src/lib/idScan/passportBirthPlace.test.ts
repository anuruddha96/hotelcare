import {describe,expect,it} from 'vitest';
import {hasPassportBirthplaceLabel,passportBirthplaceCandidates,recoverPassportBirthplace} from './passportBirthPlace';
import {guestScanPatch} from './opticalGuestFields';
import type {MrzReadResult} from './mrz';

describe('passport visual-zone birthplace recovery',()=>{
  it.each([
    ['Place of birth\nCOLOMBO','Colombo'],
    ['Place of birth / Lieu de naissance (6)\nGIBRALTAR','Gibraltar'],
    ['Sex/Sexe (5) Place of birth/Lieu de naissance (6)\nM GIBRALTAR','Gibraltar'],
    ['Doğum yeri / Place of birth: İSTANBUL','İstanbul'],
    ['Geburtsort\nMÜNCHEN','München'],
    ['Place of birfh: NEW DELHI, INDIA','New Delhi, India'],
    ['P1ace of b1rth\nBUDAPEST (HUN)','Budapest (Hun)'],
    ['Place of birth\nLieu de naissance\nPARIS','Paris'],
  ])('reads the explicitly printed birthplace: %s',(text,expected)=>{
    expect(recoverPassportBirthplace([text])).toBe(expected);
  });
  it('does not substitute the issuing authority, nationality, or a random place',()=>{
    for(const text of [
      'Place of birth\nAuthority\nLONDON',
      'Sex/Sexe Place of birth\nLONDON',
      'Place of birth\nDate of issue\nLONDON',
      'Place of birth Authority\nLONDON',
      'Nationality\nDEU\nBERLIN',
      'Place of birth\nP<DEUEXAMPLE<<EVA',
    ]) expect(passportBirthplaceCandidates(text)).toEqual([]);
  });
  it('uses independent passes and preserves accents rather than guessing a conflicting city',()=>{
    expect(recoverPassportBirthplace(['Place of birth\nPARIS','Place of birth\nLYON'])).toBeUndefined();
    expect(recoverPassportBirthplace(['Place of birth\nPECS','Place of birth\nPÉCS','Place of birth\nPARIS'])).toBe('Pécs');
    expect(hasPassportBirthplaceLabel('P1ace of b1rth')).toBe(true);
  });
  it('maps recovered birthplace directly to the existing guest form',()=>{
    const result:MrzReadResult={format:'TD3',valid:true,unknownCountry:false,lines:[],fields:{
      firstName:'Eva',lastName:'Example',mrzFirstName:'EVA',mrzLastName:'EXAMPLE',nationality:'DE',nationalityIso3:'DEU',
      dateOfBirth:'1990-01-01',gender:'female',documentType:'passport',documentNumber:'TEST123',expiryDate:'2030-01-01',issuingState:'DEU',
    }};
    const birth_place=recoverPassportBirthplace(['Place of birth\nMÜNCHEN']);
    expect(guestScanPatch(result,{birth_place}).birth_place).toBe('München');
  });
});
