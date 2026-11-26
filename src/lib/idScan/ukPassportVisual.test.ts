import {describe,it,expect} from 'vitest';
import {verifiedLegacyBirthplace,ukLegacyRegions,sampleUkRegion,localPassportContrast,passportOtsu} from './ukPassportVisual';
import {codeLineGeometry} from './codeLineRefine';
import type {MrzReadResult} from './mrz';

const result:MrzReadResult={format:'TD3',valid:true,unknownCountry:false,lines:[],fields:{
  firstName:'A',lastName:'Specimen',mrzFirstName:'A',mrzLastName:'SPECIMEN',nationality:'GB',nationalityIso3:'GBR',
  dateOfBirth:'1950-01-01',gender:'male',documentType:'passport',documentNumber:'TEST123',expiryDate:'2017-01-24',issuingState:'GBR',
}};
const read=(text:string,confidence=90)=>({text,confidence});
describe('verified legacy passport visual region recovery',()=>{
  it('recovers a value even if the tiny printed label cannot be read, using two layout anchors',()=>{
    expect(verifiedLegacyBirthplace(result,read('SPECIMEN',62),read('24 JAN /JAN 17'),[read('GIBRALTAR',72),read('BLBRALTAR',24)])).toBe('Gibraltar');
  });
  it('never hardcodes Gibraltar or infers birthplace from issuer',()=>{
    expect(verifiedLegacyBirthplace(result,read('SPECIMEN'),read('24 JAN 17'),[read('LONDON')])).toBe('London');
    expect(verifiedLegacyBirthplace(result,read('SPECIMEN'),read('24 JAN 17'),[])).toBeUndefined();
  });
  it('rejects wrong layout, low confidence, another document and conflicting OCR',()=>{
    const args=[read('SPECIMEN'),read('24 JAN 17'),[read('GIBRALTAR')]] as const;
    expect(verifiedLegacyBirthplace({...result,valid:false},...args)).toBeUndefined();
    expect(verifiedLegacyBirthplace({...result,fields:{...result.fields,issuingState:'DEU'}},...args)).toBeUndefined();
    expect(verifiedLegacyBirthplace(result,read('OTHER'),args[1],args[2])).toBeUndefined();
    expect(verifiedLegacyBirthplace(result,args[0],read('24 JAN 07'),args[2])).toBeUndefined();
    expect(verifiedLegacyBirthplace(result,args[0],args[1],[read('GIBRALTAR',45)])).toBeUndefined();
    expect(verifiedLegacyBirthplace(result,args[0],args[1],[read('GIBRALTAR'),read('LONDON')])).toBeUndefined();
    expect(verifiedLegacyBirthplace(result,args[0],args[1],[read('CSRO GIBRALTAR',90),read('GIBRALTAR')])).toBeUndefined();
  });
  it('crops the narrow field rather than nearby sex or authority cells',()=>{
    const geometry={cx:550,cy:826,width:858,height:66,angle:1,lineHeight:24,lines:2,left:121,top:789};
    const [u0,v0,u1,v1]=ukLegacyRegions.value;
    expect(geometry.cx+u0*geometry.width).toBeGreaterThan(480);
    expect(geometry.cx+u1*geometry.width).toBeLessThan(660);
    expect(geometry.cy+v0*geometry.width).toBeGreaterThan(560);
    expect(geometry.cy+v1*geometry.width).toBeLessThan(605);
  });
  it('keeps image enhancement dimensions and leaves source pixels intact',()=>{
    const data=Uint8ClampedArray.from({length:200*200},(_,i)=>i%256);
    const source={data,width:200,height:200};
    const g={cx:100,cy:150,width:160,height:15,angle:0,lineHeight:6,lines:2,left:20,top:142};
    const crop=sampleUkRegion(source,g,ukLegacyRegions.value);
    expect(crop.width).toBeGreaterThan(100);
    expect(localPassportContrast(crop).data.length).toBe(crop.data.length);
    expect(new Set(passportOtsu(crop).data)).toEqual(new Set([0,255]));
    expect(data[255]).toBe(255);
  });
  it('ignores an extra printed line when the decoded MRZ is TD3',()=>{
    const lines=[{text:'UNITEDKINGDOMGREATBRITAIN',bbox:{x0:10,y0:5,x1:200,y1:15}},
      {text:'P<GBRSPECIMEN<<A<<<<<<<<<<<<<<<<<<<<<<<<<<<<',bbox:{x0:10,y0:60,x1:200,y1:70}},
      {text:'1234567890GBR5001013M1701245<<<<<<<<<<<<<<00',bbox:{x0:10,y0:80,x1:200,y1:90}}];
    expect(codeLineGeometry(lines,1,0,0,2)?.lines).toBe(2);
    expect(codeLineGeometry(lines,1,0,0,2)?.cy).toBe(75);
  });
});
