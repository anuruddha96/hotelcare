/** Recover a visually printed passport birthplace; never derive it from
 * the issuing state, MRZ, nationality, authority or a free-floating city. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

// Includes common OCR confusions in the English label and multilingual labels.
const placeLabel = /(?:\b(?:p[l1i]ace\s*(?:of\s*)?b[i1l]r[t7]h|place\s*of\s*bir[tf]h|birth\s*place|szuletesi\s*helye?|lieu\s*de\s*naissance|geburtsort|lugar\s*de\s*nacimiento|local\s*de\s*nascimento|luogo\s*di\s*nascita|dogum\s*yeri|plaats\s*van\s*geboorte|miejsce\s*urodzenia|место\s*рождения|місце\s*народження)\b|出生地|出身地)/iu;
const otherHeader = /(?:\b(?:authority|autorite|issuing|issued|issue|expiry|expiration|validity|signature|passport|nationality|citizenship|surname|given\s*names?|family\s*name|date\s*of|sex|sexe|gender|geburtsdatum|ausstellungs|behorde|autoridad|fecha\s*de|nom\b|prenom|nationalite|date\s*de|hatosag|kiallito|ervenyes|allampolgarsag|szuletesi\s*ido|utonev|csaladnev|mother|birth\s*name)\b)/iu;

export function hasPassportBirthplaceLabel(text:string): boolean {
  return placeLabel.test(fold(text));
}

function value(raw:string, composite=false): string | undefined {
  let s = raw.trim().replace(/^[\s:;/|–—-]+/u,'').replace(/^\(\d{1,2}\)\s*/,'');
  if (composite) s = s.replace(/^(?:M|F|X|<)(?:\s*[/|]\s*(?:M|F|X))?\s+/i,'');
  s = s.replace(/[\s:;|]+$/u,'').trim();
  if (!s || s.includes('<') || placeLabel.test(fold(s)) || otherHeader.test(fold(s))) return undefined;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s,.'’()\-–]{0,119}$/u.test(s)) return undefined;
  if (s.replace(/[^\p{L}]/gu,'').length < 2 || /^(?:M|F|X|NA|N\/A|NONE|UNKNOWN)$/i.test(s)) return undefined;
  return s.toLowerCase().replace(/(^|[\s,('’\-–])\p{L}/gu,c=>c.toUpperCase()).normalize('NFC');
}

export function passportBirthplaceCandidates(text:string): string[] {
  const lines = text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
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
      const candidate=value(tail,composite);
      if(candidate) found.add(candidate);
      continue;
    }
    let next=lines[i+1]??'';
    // Some OCR engines split the translated header onto its own line.
    if(placeLabel.test(fold(next)) && !otherHeader.test(fold(next))) continue; // handled independently
    if(composite && !/^(?:M|F|X|<)(?:\s*[/|]\s*(?:M|F|X))?\s+/i.test(next)) continue;
    const candidate=value(next,composite);
    if(candidate) found.add(candidate);
  }
  return [...found];
}

const key=(s:string)=>fold(s).replace(/[\s,.]+/g,'');
/** Require agreement when there are conflicting candidates; a single
 * explicitly labeled reading can be offered for receptionist review. */
export function recoverPassportBirthplace(reads:string[]): string | undefined {
  const votes = new Map<string,{count:number;value:string}>();
  for(const read of reads){
    const candidates=passportBirthplaceCandidates(read);
    const unique=new Map(candidates.map(v=>[key(v),v]));
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
