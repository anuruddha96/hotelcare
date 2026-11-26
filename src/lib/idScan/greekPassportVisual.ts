import type { CodeGeometry } from './codeLineRefine';
import type { MrzReadResult } from './mrz';
import { passportBirthplaceKey, type BirthplaceRowRead } from './passportBirthPlace';
import { hasPrintedLabel, stripBirthCountry, titlePrinted } from './printedLabels';
import { ISO3_TO_ISO2 } from '../../../supabase/functions/_shared/viza/country';

/** Legacy Greek bilingual TD3 layout. Coordinates are fractions of the
 * observed MRZ width, not the camera guide. The region is not evidence
 * by itself: independently verify the printed surname and expiry. */
export const greekLegacyRegions = {
  value: [.145,-.264,.425,-.225],
  surname: [-.195,-.527,.085,-.481],
  expiry: [.145,-.198,.425,-.155],
} as const;

export function prioritizeGreekBirthplace(result:MrzReadResult,geometry:CodeGeometry|null):boolean {
  return result.valid && !result.unknownCountry && result.format==='TD3' &&
    result.fields.documentType==='passport' && result.fields.issuingState==='GRC' &&
    !!geometry && geometry.lines===2 && Number.isFinite(geometry.width) && geometry.width>0 &&
    Number.isFinite(geometry.height) && geometry.height>0;
}

const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function expiryMatches(raw:string,date:string|null):boolean {
  if(!date)return false;
  const [year,month,day]=date.split('-');
  const tokens=raw.toUpperCase().match(/[A-Z]+|\d+/g)??[];
  return tokens.length>=3 && /^\d{1,2}$/.test(tokens[0]) &&
    Number(tokens[0])===Number(day) && tokens.includes(months[Number(month)-1]) &&
    (tokens.at(-1)===year || tokens.at(-1)===year.slice(-2));
}

const invalidWords=/\b(?:authority|passport|surname|nationality|birth|expiry|unknown|specimen|hellenic|hellas|greece|male|female)\b/i;
function candidate(read:BirthplaceRowRead):string|undefined {
  const text=stripBirthCountry(read.text.trim().replace(/\s+/g,' '));
  if(!text || invalidWords.test(text) || hasPrintedLabel(text,'birth_place') ||
    ISO3_TO_ISO2[text.toUpperCase()] || /^(?:GR|NA|NONE|UNKNOWN)$/i.test(text) ||
    !/^[\p{Script=Latin}\p{M}][\p{Script=Latin}\p{M} .,'’()-]{2,79}$/u.test(text))return;
  return text;
}

/** Two independently located identity anchors establish this layout.
 * The birthplace itself must still be read from its own crop, never
 * constructed from MRZ or extracted from arbitrary whole-page text. */
export function verifiedGreekBirthplace(
  result:MrzReadResult, surname:BirthplaceRowRead, expiry:BirthplaceRowRead, reads:BirthplaceRowRead[],
):string|undefined {
  if(!result.valid || result.unknownCountry || result.format!=='TD3' ||
    result.fields.documentType!=='passport' || result.fields.issuingState!=='GRC')return;
  if((surname.confidence??0)<45 || (expiry.confidence??0)<50 ||
    passportBirthplaceKey(surname.text.trim())!==passportBirthplaceKey(result.fields.mrzLastName) ||
    !expiryMatches(expiry.text,result.fields.expiryDate))return;
  return agreedGreekBirthplaceCrop(reads);
}

/** Do not spend the remaining OCR budget checking layout anchors when the
 * value crops themselves do not provide a usable proposal. */
export function agreedGreekBirthplaceCrop(reads:BirthplaceRowRead[]):string|undefined {
  const plausible=reads.filter(r=>(r.confidence??0)>=55).map(r=>({value:candidate(r),confidence:r.confidence??0}))
    .filter((r):r is {value:string;confidence:number}=>!!r.value);
  if(plausible.length<2 || !plausible.some(r=>r.confidence>=65))return;
  if(!plausible.every(r=>passportBirthplaceKey(r.value)===passportBirthplaceKey(plausible[0].value)))return;
  // A second pass may split a printed word. Prefer the less fragmented
  // spelling only when the actual letters agree across independent crops.
  const sorted=[...plausible].sort((a,b)=>a.value.split(/\s+/).length-b.value.split(/\s+/).length || b.confidence-a.confidence);
  const best=sorted[0].value;
  // Never invent a space correction if both reads have an isolated letter.
  if(best.split(/\s+/).some(w=>/^\p{L}$/u.test(w)))return;
  return titlePrinted(best);
}
