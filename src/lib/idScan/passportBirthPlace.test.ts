import {describe,expect,it} from 'vitest';
import {hasPassportBirthplaceLabel,passportBirthplaceCandidates,recoverPassportBirthplace,numberedUkBirthplaceRegions,numberedGreekBirthplaceRegions,numberedBirthplaceLabel,recoverNumberedBirthplace} from './passportBirthPlace';
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


describe('numbered UK/Gibraltar passport visual layout',()=>{
  // Relative to the MRZ on the photographed specimen, not its screen edges.
  const geometry={cx:550,cy:826,width:858,height:66,angle:1,lineHeight:24,lines:2,left:121,top:789};
  it('locates field 6 above the MRZ, separately from the sex and authority fields',()=>{
    const regions=numberedUkBirthplaceRegions(geometry,'GBR')!;
    expect(geometry.cx+regions.value.u0).toBeLessThan(500);
    expect(geometry.cx+regions.value.u1).toBeGreaterThan(650);
    expect(geometry.cy+regions.value.v0).toBeLessThan(580);
    expect(geometry.cy+regions.value.v1).toBeGreaterThan(590);
    expect(geometry.cy+regions.value.v1).toBeLessThan(630);
    expect(numberedUkBirthplaceRegions(geometry,'DEU')).toBeNull();
    expect(numberedUkBirthplaceRegions({...geometry,lines:3},'GBR')).toBeNull();
  });
  const read=(text:string,confidence=90)=>({text,confidence});
  it('recovers the birthplace independently from the small bilingual label',()=>{
    expect(recoverNumberedBirthplace('Place of birth / Lieu de naissance (6)',[read('GIBRALTAR'),read('Gibraltar')])).toBe('Gibraltar');
    expect(numberedBirthplaceLabel('Lieu de naissnce (6)')).toBe(true);
    expect(recoverNumberedBirthplace('Lieu de naissnce (6)',[read('GIBRALTAR'),read('GIBRALTAR')])).toBe('Gibraltar');
  });
  it('never uses field number, issuer, unconfirmed crop or conflicting reads as evidence',()=>{
    for(const label of ['GBR','Sex (5)','(6)','Authority (8)']) expect(recoverNumberedBirthplace(label,[read('GIBRALTAR'),read('GIBRALTAR')])).toBeUndefined();
    expect(recoverNumberedBirthplace('Place of birth',[read('GIBRALTAR'),read('LONDON')])).toBeUndefined();
    expect(recoverNumberedBirthplace('Place of birth',[read('GIBRALTAR'),read('GIBRALTAR',50)])).toBeUndefined();
    expect(recoverNumberedBirthplace('Place of birth',[read('Authority'),read('Authority')])).toBeUndefined();
  });
});


describe('Greek bilingual passport birthplace',()=>{
  it.each([
    ['6. Τόπος γέννησης ΣΠΑΡΤΗ GRC\nPlace of birth SPARTI','Sparti'],
    ['Τόπος γέννησης\nΣΠΑΡΤΗ\nPlace of birth\nSPARTI GRC','Sparti'],
    ['Place of birth ΣΠΑΡΤΗ / SPARTI GRC','Sparti'],
    ['Place of birth ATHINA GRC','Athina'],
    ['Τόπος γέννησης ΠΑΤΡΑ','Πατρα'],
  ])('reads labeled Greek or printed Latin values without country suffix: %s',(raw,expected)=>{
    expect(recoverPassportBirthplace([raw],'GRC')).toBe(expected);
  });
  it('recognizes Greek labels without requiring Latin word boundaries',()=>{
    expect(hasPassportBirthplaceLabel('6. Τόπος γέννησης')).toBe(true);
    expect(hasPassportBirthplaceLabel('ΤΟΠΟΣ ΓΕΝΝΗΣΗΣ')).toBe(true);
    expect(hasPassportBirthplaceLabel('Ημ. γέννησης')).toBe(false);
  });
  it('rejects missing values, authority, country alone and conflicting reads',()=>{
    for(const raw of [
      'Place of birth\nGRC',
      'Τόπος γέννησης\nΗμ. έκδοσης\nATHINA',
      'Place of birth\nAuthority\nATHINA',
      'Nationality GRC\nSPARTI',
    ]) expect(recoverPassportBirthplace([raw],'GRC')).toBeUndefined();
    expect(recoverPassportBirthplace(['Place of birth SPARTI','Place of birth ATHINA'],'GRC')).toBeUndefined();
  });
  it('locates the legacy Greek Latin value independently of the country column',()=>{
    const geometry={cx:478,cy:820,width:745,height:65,angle:0,lineHeight:24,lines:2,left:105,top:788};
    const regions=numberedGreekBirthplaceRegions(geometry,'GRC')!;
    expect(geometry.cx+regions.value.u0).toBeLessThan(600);
    expect(geometry.cx+regions.value.u1).toBeGreaterThan(670);
    expect(geometry.cx+regions.value.u1).toBeLessThan(809);
    expect(geometry.cy+regions.value.v0).toBeLessThan(633);
    expect(geometry.cy+regions.value.v1).toBeGreaterThan(646);
    expect(numberedGreekBirthplaceRegions(geometry,'GBR')).toBeNull();
    expect(numberedGreekBirthplaceRegions({...geometry,lines:3},'GRC')).toBeNull();
  });
  it('requires label evidence and two agreeing Latin crop readings',()=>{
    const read=(text:string,confidence=90)=>({text,confidence});
    expect(recoverNumberedBirthplace('Place of birth',[read('SPARTI'),read('SPARTI')],'GRC')).toBe('Sparti');
    expect(recoverNumberedBirthplace('Τόπος γέννησης',[read('SPARTI'),read('SPARTI GRC')],'GRC')).toBe('Sparti');
    expect(recoverNumberedBirthplace('6',[read('SPARTI'),read('SPARTI')],'GRC')).toBeUndefined();
    expect(recoverNumberedBirthplace('Place of birth',[read('SPARTI'),read('ATHINA')],'GRC')).toBeUndefined();
    expect(recoverNumberedBirthplace('Place of birth',[read('SPARTI'),read('SPARTI',40)],'GRC')).toBeUndefined();
    expect(recoverNumberedBirthplace('Place of birth',[read('GRC'),read('GRC')],'GRC')).toBeUndefined();
  });
});
