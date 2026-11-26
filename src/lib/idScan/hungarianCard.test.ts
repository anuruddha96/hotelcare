import {describe,it,expect} from 'vitest';
import {estimateCardRect,printedRowRect,mergeHungarianRows,rowHasLabel,parsePrintedRow,needsHungarianPrintedFallback,corroboratedMotherName,mergeHungarianFallback} from './hungarianCard';
import {extractOpticalGuestFields} from './opticalGuestFields';

describe('Hungarian ID specimen printed regions',()=>{
  const rows=[
    {row:'birth_place' as const,label:'Születési hely / Place of birth:',value:'PÉCS (HUN)',confidence:92},
    {row:'birth_pair' as const,label:'Születési családi és utónév / Family name and given name at birth',value:'MINTA ÉVA',confidence:88},
    {row:'mother_name' as const,label:"Anyja születési neve / Mother's maiden name",value:'PÉLDA ANNA',confidence:93},
  ];
  it('uses confirmed labeled rows without hardcoded specimen values',()=>{
    expect(mergeHungarianRows(true,rows)).toEqual({birth_place:'Pécs',birth_last_name:'Minta',birth_first_name:'Éva',mother_name:'Példa Anna'});
    expect(mergeHungarianRows(false,rows)).toEqual({});
    expect(mergeHungarianRows(true,rows.slice(0,1))).toEqual({});
    expect(mergeHungarianRows(true,[...rows.slice(0,2),{...rows[2],label:'address'}])).not.toHaveProperty('mother_name');
    expect(mergeHungarianRows(true,[...rows.slice(0,2),{...rows[2],confidence:40}])).not.toHaveProperty('mother_name');
  });
  it('retries targeted Hungarian rows when located OCR misses the maiden name',()=>{
    const partial={birth_place:'Pécs',birth_last_name:'Minta',birth_first_name:'Éva'};
    expect(needsHungarianPrintedFallback(true,partial)).toBe(true);
    expect(needsHungarianPrintedFallback(true,{})).toBe(true);
    expect(needsHungarianPrintedFallback(false,partial)).toBe(false);
    const recovered={...mergeHungarianRows(true,rows),...partial};
    expect(recovered.mother_name).toBe('Példa Anna');
    expect(needsHungarianPrintedFallback(true,recovered)).toBe(false);
    expect(rowHasLabel('mother_name',"Mother ’ s maiden name")).toBe(true);
    expect(rowHasLabel('mother_name','Anyja születési neve')).toBe(true);
  });
  it('does not invent a split for ambiguous names',()=>{
    expect(parsePrintedRow('birth_pair','MINTA ÉVA ANNA')).toEqual({});
    expect(parsePrintedRow('mother_name','ANNA')).toEqual({});
    expect(rowHasLabel('mother_name','Date of birth')).toBe(false);
  });
  it('locates a card on a dark border and maps rows inside it',()=>{
    const w=160,h=100,gray=new Uint8Array(w*h).fill(25);
    for(let y=5;y<95;y++)for(let x=9;x<151;x++)gray[y*w+x]=220;
    const r=estimateCardRect(gray,w,h);
    expect(r).toEqual({x:9,y:5,width:142,height:90});
    const crop=printedRowRect(r,'mother_name',true);
    expect(crop.y).toBeGreaterThan(r.y);
    expect(crop.x+crop.width).toBeLessThan(r.x+r.width);
  });
  it('recovers birth date and citizenship only with a corresponding printed label',()=>{
    expect(extractOpticalGuestFields('Születési időate of bith 30 06 1990\nNeme Sex / Allampolgarsag HUN')).toMatchObject({date_of_birth:'1990-06-30',nationality:'HU'});
    expect(extractOpticalGuestFields('HUNGARY\nExpiry date 10 01 2022')).toEqual({});
    expect(extractOpticalGuestFields('Date of birth 31 02 1990')).toEqual({});
  });
});

describe('partial Hungarian back scan recovery', () => {
  const motherRow = {row:'mother_name' as const, label:"Anyja születési neve / Mother's maiden name", confidence:95};
  const located = {birth_place:'Pécs', mother_name:'Pél Da Anna'};
  const fallback = {birth_last_name:'Minta', birth_first_name:'Éva', mother_name:'Példa Anna'};
  it('recovers both birth fields and fixes corroborated OCR-inserted spaces', () => {
    const reads = [{...motherRow,value:'PÉLDA ANNA'},{...motherRow,value:'PELDA ANNA'}];
    expect(needsHungarianPrintedFallback(true,located)).toBe(true);
    const recovered = mergeHungarianFallback(located,fallback,corroboratedMotherName(reads));
    expect(recovered).toEqual({birth_place:'Pécs',...fallback});
    expect(needsHungarianPrintedFallback(true,recovered)).toBe(false);
  });
  it('retries a split maiden name even when all other fields were extracted', () => {
    expect(needsHungarianPrintedFallback(true,{...fallback,...located})).toBe(true);
  });
  it('does not guess a mother name from a single read, disagreement or different letters', () => {
    expect(corroboratedMotherName([{...motherRow,value:'PÉLDA ANNA'}])).toBeUndefined();
    expect(corroboratedMotherName([{...motherRow,value:'PÉLDA ANNA'},{...motherRow,value:'PÉL DA ANNA'}])).toBeUndefined();
    expect(mergeHungarianFallback(located,fallback,'Másik Anna').mother_name).toBe(located.mother_name);
    expect(mergeHungarianFallback({mother_name:'Nagy Kiss Anna'},fallback).mother_name).toBe('Nagy Kiss Anna');
  });
  it('never combines half a birth name from different evidence', () => {
    expect(mergeHungarianFallback({birth_last_name:'Másik'},fallback).birth_first_name).toBeUndefined();
    expect(mergeHungarianFallback({}, {birth_last_name:'Minta'})).toEqual({});
  });
});
