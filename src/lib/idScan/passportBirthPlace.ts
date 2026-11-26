import type { CodeGeometry } from './codeLineRefine';
import { hasPrintedLabel, resolvePrintedLabels, titlePrinted } from './printedLabels';

/** Recover a visually printed passport birthplace; never derive it from
 * the issuing state, MRZ, nationality, authority or a free-floating city. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

// Includes common OCR confusions in the English label and multilingual labels.
const placeLabel = /(?:\b(?:p[l1i]ace\s*(?:of\s*)?b[i1l]r[t7]h|place\s*of\s*bir[tf]h|birth\s*place|szuletesi\s*helye?|lieu\s*de\s*naissance|geburtsort|lugar\s*de\s*nacimiento|local\s*de\s*nascimento|luogo\s*di\s*nascita|dogum\s*yeri|plaats\s*van\s*geboorte|miejsce\s*urodzenia|место\s*рождения|місце\s*народження)\b|τοπος\s*γεννησης(?!\p{L})|出生地|出身地)/iu;
const otherHeader = /(?:\b(?:authority|autorite|issuing|issued|issue|expiry|expiration|validity|signature|passport|nationality|citizenship|surname|given\s*names?|family\s*name|date\s*of|sex|sexe|gender|geburtsdatum|ausstellungs|behorde|autoridad|fecha\s*de|nom\b|prenom|nationalite|date\s*de|hatosag|kiallito|ervenyes|allampolgarsag|szuletesi\s*ido|utonev|csaladnev|mother|birth\s*name)\b|(?:ημ\.?\s*)?(?:γεννησης|εκδοσης|ληξης)(?!\p{L})|εκδουσα\s*αρχη|υπηρεσια|επωνυμο|ονομα|ιθαγενεια|φυλο)/iu;

export function hasPassportBirthplaceLabel(text:string): boolean {
  return placeLabel.test(fold(text)) || hasPrintedLabel(text,'birth_place');
}

function value(raw:string, composite=false, issuingState?:string): string | undefined {
  let s = raw.trim().replace(/^[\s:;/|–—-]+/u,'').replace(/^\(\d{1,2}\)\s*/,'');
  if (issuingState === 'GRC') {
    // The country of birth is printed in a separate column on this layout.
    // Strip only an explicit Greek country token; never use it as the city.
    s = s.replace(/\s+(?:GRC|\(GRC\))$/u,'').trim();
    if (/^(?:GRC|GR)$/i.test(s)) return undefined;
    // A Greek value followed by its printed Latin spelling on the same row.
    const bilingual = /^([\p{Script=Greek}\p{M} .'-]+)[\s/|]+([\p{Script=Latin}\p{M} .'-]+)$/u.exec(s);
    if (bilingual) s = bilingual[2].trim();
  }
  if (composite) s = s.replace(/^(?:M|F|X|<)(?:\s*[/|]\s*(?:M|F|X))?\s+/i,'');
  s = s.replace(/[\s:;|]+$/u,'').trim();
  if (!s || s.includes('<') || placeLabel.test(fold(s)) || otherHeader.test(fold(s))) return undefined;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s,.'’()\-–]{0,119}$/u.test(s)) return undefined;
  if (s.replace(/[^\p{L}]/gu,'').length < 2 || /^(?:M|F|X|NA|N\/A|NONE|UNKNOWN)$/i.test(s)) return undefined;
  return s.toLowerCase().replace(/(^|[\s,('’\-–])\p{L}/gu,c=>c.toUpperCase()).normalize('NFC');
}

export function passportBirthplaceCandidates(text:string, issuingState?:string): string[] {
  if (issuingState !== 'GRC') return [...new Set(resolvePrintedLabels(text).filter(c=>c.field==='birth_place').map(c=>titlePrinted(c.value)))];
  const lines = text.normalize('NFC').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const found = new Set<string>();
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    const normalized = fold(line);
    const match = placeLabel.exec(normalized);
    if(!match) continue;
    const before = normalized.slice(0,match.index);
    const composite = /\b(?:sex|sexe|gender)\b/.test(before);
    // Adjacent labels on a multi-column row: do not guess their values.
    if(otherHeader.test(before) && !composite) continue;
    let tail = line.slice(match.index+match[0].length).trim();
    // Strip only explicitly recognized repeated translations/field numbers.
    for(let j=0;j<4;j++){
      tail = tail.replace(/^[\s:/|–—-]+/u,'').replace(/^\(\d{1,2}\)\s*/,'').trim();
      const repeated=placeLabel.exec(fold(tail));
      if(!repeated || repeated.index!==0) break;
      tail=tail.slice(repeated[0].length);
    }
    tail=tail.replace(/^[\s:/|–—-]+/u,'').replace(/^\(\d{1,2}\)\s*/,'').trim();
    if(tail){
      const candidate=value(tail,composite,issuingState);
      if(candidate) {
        // Consecutive Greek and English birthplace rows are one bilingual field.
        const nextLine = lines[i+1] ?? '';
        const english = /(?:p[l1i]ace\s*(?:of\s*)?b[i1l]r[t7]h|birth\s*place)/iu.exec(nextLine);
        const latin = english && value(nextLine.slice(english.index+english[0].length),false,issuingState);
        if (!(issuingState === 'GRC' && /\p{Script=Greek}/u.test(candidate) && latin && /^\p{Script=Latin}/u.test(latin))) found.add(candidate);
      }
      continue;
    }
    const next=lines[i+1]??'';
    // Some OCR engines split the translated header onto its own line.
    if(placeLabel.test(fold(next)) && !otherHeader.test(fold(next))) continue; // handled independently
    if(composite && !/^(?:M|F|X|<)(?:\s*[/|]\s*(?:M|F|X))?\s+/i.test(next)) continue;
    const candidate=value(next,composite,issuingState);
    if(candidate) {
      // A label-only Greek row can be followed by its Greek value and then
      // the English label/value. Prefer the explicitly labeled Latin row.
      const after = lines[i+2] ?? '';
      const english = /(?:p[l1i]ace\s*(?:of\s*)?b[i1l]r[t7]h|birth\s*place)/iu.exec(after);
      const latin = english && value(after.slice(english.index+english[0].length).trim() || (lines[i+3] ?? ''),false,issuingState);
      if (!(issuingState === 'GRC' && /^\p{Script=Greek}/u.test(candidate) && latin && /^\p{Script=Latin}/u.test(latin))) found.add(candidate);
    }
  }
  return [...found];
}

export const passportBirthplaceKey=(s:string)=>fold(s).replace(/[\s,.]+/g,'');
/** Require agreement when there are conflicting candidates; a single
 * explicitly labeled reading can be offered for receptionist review. */
export function recoverPassportBirthplace(reads:string[], issuingState?:string): string | undefined {
  const votes = new Map<string,{count:number;value:string}>();
  for(const read of reads){
    const candidates=passportBirthplaceCandidates(read,issuingState);
    const unique=new Map(candidates.map(v=>[passportBirthplaceKey(v),v]));
    for(const [k,v] of unique){
      const old=votes.get(k);
      const accents=(s:string)=>(s.normalize('NFD').match(/[\u0300-\u036f]/g)??[]).length;
      votes.set(k,{count:(old?.count??0)+1,value:old&&accents(old.value)>accents(v)?old.value:v});
    }
  }
  const ordered=[...votes.values()].sort((a,b)=>b.count-a.count);
  if(!ordered.length) return undefined;
  if(ordered.length>1 && (ordered[0].count<2 || ordered[0].count===ordered[1].count)) return undefined;
  return ordered[0].value;
}


/** Legacy numbered UK/Gibraltar passport layout. All offsets are measured
 * from the actual MRZ rather than the camera guide or screenshot edges.
 * Positions only propose a crop; the printed birthplace label must verify it. */
export function numberedUkBirthplaceRegions(geometry: CodeGeometry, issuingState: string) {
  if (geometry.lines !== 2 || issuingState !== 'GBR' || geometry.width <= 0 ||
      !Number.isFinite(geometry.width) || geometry.height <= 0) return null;
  const w=geometry.width;
  const rect=(u0:number,v0:number,u1:number,v1:number)=>({u0:u0*w,v0:v0*w,u1:u1*w,v1:v1*w});
  return {
    row: rect(-.19,-.355,.29,-.245),
    label: rect(-.10,-.343,.30,-.285),
    value: rect(-.075,-.310,.28,-.253),
  };
}

/** The tiny numbered blue label may be partly read. Require an actual
 * birthplace label, or its recognizable French fragment plus field (6).
 * Neither the issuer, the gender, nor the field number alone is sufficient. */
export function numberedBirthplaceLabel(text:string): boolean {
  const normalized=fold(text);
  return hasPassportBirthplaceLabel(text) ||
    (/\(?\s*6\s*\)?/.test(normalized) && /(?:lieu|plac[e3]|p[l1i]ac[e3])/.test(normalized) &&
      /(?:naiss[a-z]{2,5}|b[i1l]r[t7]h|birfh)/.test(normalized));
}

/** Older Greek bilingual passport: English label and Latin value are
 * printed below the Greek row, to the right of the portrait. Geometry
 * proposes a region only; a recognized label and agreeing reads verify it. */
export function numberedGreekBirthplaceRegions(geometry: CodeGeometry, issuingState: string) {
  if (geometry.lines !== 2 || issuingState !== 'GRC' || geometry.width <= 0 ||
      !Number.isFinite(geometry.width) || geometry.height <= 0) return null;
  const w = geometry.width;
  const rect=(u0:number,v0:number,u1:number,v1:number)=>({u0:u0*w,v0:v0*w,u1:u1*w,v1:v1*w});
  return {
    row: rect(-.21,-.302,.49,-.226),
    label: rect(-.21,-.301,.025,-.229),
    value: rect(.145,-.257,.425,-.226),
  };
}

export type BirthplaceRowRead = { text:string; confidence:number|null };
/** Require two independent agreeing, confidently read value-only crops
 * and a printed label from the same localized row. */
export function recoverNumberedBirthplace(label:string, reads:BirthplaceRowRead[], issuingState?:string): string|undefined {
  if(!numberedBirthplaceLabel(label)) return undefined;
  const candidates=reads.filter(r=>r.confidence!==null && r.confidence>=65)
    .map(r=>value(r.text.replace(/\s+/g,' '),false,issuingState)).filter((v):v is string=>!!v);
  if(issuingState === 'GRC' && candidates.some(v=>!/^[\p{Script=Latin}\p{M} .,'’()\-–]+$/u.test(v))) return undefined;
  if(candidates.length<2 || !candidates.every(v=>passportBirthplaceKey(v)===passportBirthplaceKey(candidates[0]))) return undefined;
  return candidates.reduce((a,b)=>a.normalize('NFD').length>=b.normalize('NFD').length?a:b);
}
