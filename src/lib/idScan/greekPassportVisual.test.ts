import {describe,it,expect} from 'vitest';
import {greekLegacyRegions,prioritizeGreekBirthplace,verifiedGreekBirthplace} from './greekPassportVisual';
import type {MrzReadResult} from './mrz';

const passport:MrzReadResult={format:'TD3',valid:true,unknownCountry:false,lines:[],fields:{
  firstName:'Example',lastName:'Tester',mrzFirstName:'EXAMPLE',mrzLastName:'TESTER',
  nationality:'GR',nationalityIso3:'GRC',dateOfBirth:'1990-01-01',gender:'female',
  documentType:'passport',documentNumber:'TEST123',expiryDate:'2031-02-14',issuingState:'GRC',
}};
const read=(text:string,confidence=90)=>({text,confidence});
const geometry={cx:478,cy:820,width:745,height:65,angle:0,lineHeight:24,lines:2,left:105,top:788};
describe('verified Greek printed birthplace recovery',()=>{
  it('prioritizes the small printed field only on a valid Greek passport with observed MRZ geometry',()=>{
    expect(prioritizeGreekBirthplace(passport,geometry)).toBe(true);
    expect(prioritizeGreekBirthplace(passport,null)).toBe(false);
    expect(prioritizeGreekBirthplace({...passport,valid:false},geometry)).toBe(false);
    expect(prioritizeGreekBirthplace({...passport,fields:{...passport.fields,issuingState:'GBR'}},geometry)).toBe(false);
    expect(prioritizeGreekBirthplace(passport,{...geometry,lines:3})).toBe(false);
  });
  it('recovers the printed city despite an unreadable label and split OCR letters',()=>{
    expect(verifiedGreekBirthplace(passport,read('TESTER',70),read('14 FEB 31',80),
      [read('KALAMAT A',57),read('KALAMATA',82)])).toBe('Kalamata');
    expect(verifiedGreekBirthplace(passport,read('TESTER'),read('14 FEB 2031'),
      [read('PATRAS'),read('PATRAS GRC')])).toBe('Patras');
  });
  it('requires both independent layout anchors and two agreeing value reads',()=>{
    const values=[read('PATRAS'),read('PATRAS')];
    expect(verifiedGreekBirthplace(passport,read('OTHER'),read('14 FEB 31'),values)).toBeUndefined();
    expect(verifiedGreekBirthplace(passport,read('TESTER'),read('14 FEB 30'),values)).toBeUndefined();
    expect(verifiedGreekBirthplace(passport,read('TESTER'),read('14 FEB 31'),[read('PATRAS')])).toBeUndefined();
    expect(verifiedGreekBirthplace(passport,read('TESTER'),read('14 FEB 31'),[read('PATRAS'),read('ATHENS')])).toBeUndefined();
    expect(verifiedGreekBirthplace(passport,read('TESTER'),read('14 FEB 31'),[read('PATRAS',59),read('PATRAS',54)])).toBeUndefined();
    expect(verifiedGreekBirthplace(passport,read('TESTER'),read('14 FEB 31'),[read('PATRA S'),read('PATRA S')])).toBeUndefined();
  });
  it('never promotes country, header, MRZ or foreign issuer values',()=>{
    for(const text of ['GRC','HELLENIC','GREECE','PLACE OF BIRTH','AUTHORITY','P<GRCEXAMPLE<<TESTER']) {
      expect(verifiedGreekBirthplace(passport,read('TESTER'),read('14 FEB 31'),[read(text),read(text)])).toBeUndefined();
    }
    expect(verifiedGreekBirthplace({...passport,fields:{...passport.fields,issuingState:'GBR'}},read('TESTER'),read('14 FEB 31'),[read('PATRAS'),read('PATRAS')])).toBeUndefined();
  });
  it('isolates the three printed regions above the MRZ without overlapping',()=>{
    const [u0,v0,u1,v1]=greekLegacyRegions.value;
    expect(geometry.cx+u0*geometry.width).toBeLessThan(600);
    expect(geometry.cx+u1*geometry.width).toBeGreaterThan(670);
    expect(geometry.cy+v0*geometry.width).toBeLessThan(633);
    expect(geometry.cy+v1*geometry.width).toBeGreaterThan(646);
    expect(greekLegacyRegions.surname[3]).toBeLessThan(v0);
    expect(greekLegacyRegions.expiry[1]).toBeGreaterThan(v1);
  });
});
