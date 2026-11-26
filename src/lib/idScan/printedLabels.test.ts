import {describe,expect,it} from 'vitest';
import {resolvePrintedLabels,choosePrintedValue,splitPrintedMotherName,splitPrintedBirthName,stripBirthCountry} from './printedLabels';
import {extractOpticalGuestFields,opticalGuestFields} from './opticalGuestFields';
import {recoverPassportBirthplace} from './passportBirthPlace';
import type {MrzReadResult} from './mrz';

describe('shared printed-field resolver',()=>{
  it.each([
    ['Place of birth / Lieu de naissance / Lugar de nacimiento\nNEW YORK, U.S.A.','New York, U.S.A.'],
    ['Place of Birth / wea err\nMUMBAI, MAHARASHTRA','Mumbai, Maharashtra'],
    ['Place of Birth Sex\nCOLOMBO M','Colombo'],
    ['Date of birth Place of birth\n01 JAN 1980 PARIS','Paris'],
    ['Sex/Sexe (5) Place of birth/Lieu de naissance (6)\nM\nGIBRALTAR','Gibraltar'],
    ['Sex/Sexe (5) Place of birth/Lieu de naissance (6)\nGIBRALTAR','Gibraltar'],
    ['Place of birth: Colombo 07','Colombo 07'],
    ['Place of birth\nLONDON / LONDRES','London / Londres'],
    ['Loc nastere/Lieu de naissance/Place of birth\nMun.Bucuresti Sec.1','Mun.Bucuresti Sec.1'],
    ['Születési hely/Place of birth:\nBUDAPEST','Budapest'],
    ['Geburtsort/Place of birth\nMÜNCHEN','München'],
    ['Miejsce urodzenia\nKRAKÓW','Kraków'],
    ['Miesto narodenia\nBRATISLAVA','Bratislava'],
  ])('returns the labeled value in both parsers: %s',(text,expected)=>{
    expect(extractOpticalGuestFields(text).birth_place).toBe(expected);
    expect(recoverPassportBirthplace([text])).toBe(expected);
  });
  it.each([
    'Place of birth\nAuthority\nCSRO GIBRALTAR',
    'Place of birth\nP<DEUTEST<<GUEST',
    'Place of birth\nDate of expiry\nLONDON',
    'Place of birth / wea err',
    'Place of birth\nLugar de nacimiento',
    'Place of birth\n--- OCR PASS ---\nLONDON',
    'Nationality\nGRC\nSPARTI',
    'Place of birth\nGRC',
  ])('does not propose unrelated or unreadable values: %s',text=>{
    expect(extractOpticalGuestFields(text).birth_place).toBeUndefined();
    expect(recoverPassportBirthplace([text])).toBeUndefined();
  });
  it('only removes a separate recognized country suffix',()=>{
    for(const input of ['BUDAPEST','MÜNCHEN','LONDON ABC'])expect(stripBirthCountry(input)).toBe(input);
    for(const input of ['BUDAPEST HUN','BUDAPEST (HUN)','BUDAPEST ( HUN )'])expect(stripBirthCountry(input)).toBe('BUDAPEST');
  });
  it('chooses independent agreement and the stronger confidence, not an arbitrary tie',()=>{
    expect(choosePrintedValue([{value:'Pecs'},{value:'Pécs'}])).toEqual({value:'Pécs',status:'agreed'});
    expect(choosePrintedValue([{value:'Paris',confidence:91},{value:'Lyon',confidence:70}])).toEqual({value:'Paris',status:'single reading'});
    expect(choosePrintedValue([{value:'Paris'},{value:'Lyon'}])).toBeUndefined();
  });
  it('proposes editable names without dropping multi-word values',()=>{
    expect(splitPrintedMotherName('Nagy Éva Mária')).toEqual({mother_family_name:'Nagy',mother_given_name:'Éva Mária'});
    expect(splitPrintedMotherName('Nagy')).toEqual({mother_family_name:'Nagy',mother_given_name:null});
    expect(splitPrintedBirthName('KOVÁCS ANNA MÁRIA','ANNA MARIA',true)).toEqual({birth_last_name:'Kovács',birth_first_name:'Anna Mária'});
    expect(resolvePrintedLabels('Geburtsname/Name at birth\nGABLER')).toMatchObject([{field:'birth_last_name',value:'GABLER'}]);
    const result:MrzReadResult={format:'TD1',valid:true,unknownCountry:false,lines:[],fields:{
      firstName:'Anna',lastName:'Example',mrzFirstName:'ANNA',mrzLastName:'EXAMPLE',nationality:'DE',nationalityIso3:'DEU',
      dateOfBirth:'1990-01-01',gender:'female',documentType:'id_card',documentNumber:'TEST123',expiryDate:'2030-01-01',issuingState:'DEU',
    }};
    expect(opticalGuestFields(result,'','Geburtsname/Name at birth\nGABLER')).toMatchObject({birth_last_name:'Gabler',birth_first_name:'Anna'});
  });
});

describe('bilingual label rests and row neighbours',()=>{
  it('skips a misread English label half and takes the value on the next line',()=>{
    expect(resolvePrintedLabels('Anyja születési neve Moth Aid\nKALCSÓ IRMA')).toEqual([{field:'mother_name',value:'KALCSÓ IRMA',rule:'next-line'}]);
  });
  it('drops the document number printed on the mother\'s-name row of a Hungarian card',()=>{
    expect(resolvePrintedLabels('Anyja szűletési neve Mothers maiden name.\nKALCSÓ IRMA 000000XX')).toEqual([{field:'mother_name',value:'KALCSÓ IRMA',rule:'next-line'}]);
  });
  it('keeps real names that only start like a label word',()=>{
    expect(resolvePrintedLabels('Anyja születési neve: MOHÁCSI IRMA')).toEqual([{field:'mother_name',value:'MOHÁCSI IRMA',rule:'inline'}]);
  });
});
