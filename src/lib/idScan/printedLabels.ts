import { ISO3_TO_ISO2 } from '../../../supabase/functions/_shared/viza/country';

/** Printed-zone proposals only. Never modify the MRZ or certify a proposal. */
export type PrintedLabel = 'birth_place'|'birth_pair'|'birth_last_name'|'birth_first_name'|'mother_name';
export const foldPrinted = (s:string) => s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const patterns: Record<PrintedLabel,string> = {
  birth_place: 'p[l1i]ace\\s*(?:of\\s*)?b[i1l]r[t7f]h|birth\\s*place(?!\\s*of\\s*birth)|szuletesi\\s*helye?|lieu\\s*de\\s*naissance|geburtsort|lugar\\s*de\\s*nacimiento|local\\s*de\\s*nascimento|luogo\\s*di\\s*nascita|dogum\\s*yeri|plaats\\s*van\\s*geboorte|miejsce\\s*urodzenia|loc(?:ul)?\\s*nasterii?|misto\\s*narozeni|miesto\\s*narodenia|mjesto\\s*rodenja|τοπος\\s*γεννησης|место\\s*рождения|місце\\s*народження|出生地|出身地',
  birth_pair: 'szuletesi\\s*csalad(?:i)?\\s*es\\s*uto(?:neve|nev)|family\\s*name\\s*and\\s*given\\s*names?\\s*at\\s*birth|szuletesi\\s*neve?|birth\\s*name|name\\s*at\\s*birth|nome\\s*de\\s*nascimento',
  birth_last_name: 'szuletesi\\s*csalad(?:i)?nev|family\\s*name\\s*at\\s*birth|birth\\s*surname|surname\\s*at\\s*birth|geburtsname|nom\\s*de\\s*naissance|apellido[s]?\\s*de\\s*nacimiento|cognome\\s*alla\\s*nascita|geboortenaam|nazwisko\\s*rodowe|nume\\s*la\\s*nastere|rodne\\s*prijmeni|rodne\\s*priezvisko|rodeno\\s*prezime|dogum\\s*soyadi',
  birth_first_name: 'szuletesi\\s*uto(?:neve|nev)|given\\s*names?\\s*at\\s*birth|birth\\s*given\\s*names?|prenoms?\\s*de\\s*naissance',
  mother_name: '(?:anyja|auyja|aryja)\\s*(?:szuletesi\\s*)?(?:csalad(?:i)?\\s*es\\s*uto(?:neve|nev)|neve?)|mother(?:[’\\x27]s|s)?\\s*(?:(?:birth|maiden|marden)\\s*name|family\\s*name\\s*and\\s*given\\s*names?\\s*at\\s*birth|name)|nom\\s*(?:de\\s*naissance\\s*)?de\\s*la\\s*mere|name\\s*der\\s*mutter|geburtsname\\s*der\\s*mutter|nombre\\s*de\\s*la\\s*madre|nome\\s*della\\s*madre|nome\\s*da\\s*mae|naam\\s*van\\s*de\\s*moeder|imie\\s*matki|numele\\s*mamei|jmeno\\s*matky|meno\\s*matky|ime\\s*majke|anne\\s*adi',
};
const boundary = (p:string) => new RegExp('(?<![\\p{L}\\p{N}])(?:'+p+')(?![\\p{L}\\p{N}])','giu');
const other = boundary('authority|autorite|issuing|issued|issue|expiry|expiration|validity|signature|passport|nationality|citizenship|surname|given\\s*names?|family\\s*name|date\\s*of\\s*(?:birth|issue|expiry|expiration)|sex|sexe|gender|geburtsdatum|ausstellungsdatum|behorde|autoridad|fecha\\s*de\\s*(?:nacimiento|expedicion|caducidad)|nom|prenom[s]?|nationalite|date\\s*de\\s*(?:naissance|delivrance|expiration)|hatosag|kiallito|ervenyes|allampolgarsag|szuletesi\\s*ido|utonev|csaladnev|document\\s*(?:no|number)|address|lakcim|height|personal\\s*number|επωνυμο|ονομα|ιθαγενεια|φυλο|ημ\\.?\\s*(?:γεννησης|εκδοσης|ληξης)|εκδουσα\\s*αρχη|data\\s*di\\s*nascita|data\\s*de\\s*nascimento|data\\s*urodzenia|datum\\s*narozeni|datum\\s*narodenia|datum\\s*rodenja|geboortedatum|dogum\\s*tarihi|autoritate|data\\s*nasterii|nationalitat|nazwisko|imie|prezime|prijmeni|priezvisko|soyadi');
type Hit = {field:PrintedLabel|'other';start:number;end:number;text:string};
function hits(line:string):Hit[] {
  const f=foldPrinted(line);
  const all:Hit[]=[];
  for(const [field,p] of Object.entries(patterns) as [PrintedLabel,string][]) {
    for(const m of f.matchAll(boundary(p))) all.push({field,start:m.index!,end:m.index!+m[0].length,text:m[0]});
  }
  for(const m of f.matchAll(other)) all.push({field:'other',start:m.index!,end:m.index!+m[0].length,text:m[0]});
  // A full specific label takes precedence over a shorter overlapping label.
  const sorted=all.sort((a,b)=>a.start-b.start || b.end-a.end || Number(a.field==='other')-Number(b.field==='other'));
  const out:Hit[]=[];
  for(const h of sorted) if(!out.some(x=>h.start<x.end&&h.end>x.start)) out.push(h);
  return out;
}
export function hasPrintedLabel(text:string,field:PrintedLabel):boolean {
  return hits(text).some(h=>h.field===field);
}
export function stripBirthCountry(value:string):string {
  const m=/(?:\s*\(\s*([A-Z]{3})\s*\)|\s+([A-Z]{3}))$/u.exec(value);
  return m && ISO3_TO_ISO2[m[1]??m[2]] ? value.slice(0,m.index).trim() : value.trim();
}
export const titlePrinted = (s:string) => s.split(/(\s+)/u).map(w=>/^(?:[A-Za-z]\.){2,}$/u.test(w)?w.toUpperCase():w.toLowerCase().replace(/(^|[.’'-])\p{L}/gu,c=>c.toUpperCase())).join('').normalize('NFC');
const mrz=(s:string)=>s.includes('<<')||/^--- OCR PASS ---$/u.test(s)||/^[A-Z0-9<]{25,}$/u.test(s);
const sex=/^[MFX<]$/i;
const date= /^(?:\d{1,2}\s+[A-Z]{3}(?:\s*\/\s*[A-Z]{3})?\s+\d{2,4}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/i;
const dateOnly=(s:string)=>{const m=date.exec(s);return !!m&&m[0].length===s.length;};
function cleanValue(raw:string,field:PrintedLabel):string|undefined {
  if (mrz(raw.trim())) return;
  let s=raw.trim().replace(/^[\s:;|–—-]+/u,'').replace(/^\(\d{1,2}\)\s*/u,'').trim();
  if (field==='birth_place') s=stripBirthCountry(s);
  if(!s||mrz(s)||hits(s).length||/^(?:NA|N\/A|NONE|UNKNOWN|M|F|X)$/i.test(s)||ISO3_TO_ISO2[s])return;
  if(s.replace(/[^\p{L}]/gu,'').length<2)return;
  if(field==='birth_place') {
    if(!/^[\p{L}\p{M}][\p{L}\p{M}\d ,.'’()/\-–]{1,199}$/u.test(s))return;
  } else if(!/^[\p{L}\p{M}][\p{L}\p{M} .,'’/\-]{1,79}$/u.test(s))return;
  return s;
}
export type PrintedCandidate={field:PrintedLabel;value:string;rule:'inline'|'next-line'|'composite'};
export function resolvePrintedLabels(text:string):PrintedCandidate[] {
  const lines=text.normalize('NFC').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const out:PrintedCandidate[]=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i], labels=hits(line), targets=labels.filter(h=>h.field!=='other');
    if(!targets.length||mrz(line))continue;
    const fields=[...new Set(targets.map(h=>h.field))];
    if(fields.length!==1 && !(fields.length===2 && fields.includes('birth_last_name') && fields.includes('birth_pair') && /[/|]/u.test(line)))continue;
    const field=(fields.includes('birth_last_name')?'birth_last_name':fields[0]) as PrintedLabel;
    const others=labels.filter(h=>h.field==='other');
    // Only composite sex/date-of-birth rows have unambiguous removable values.
    if(others.some(h=>! /^(?:sex|sexe|gender|φυλο|date\s*of\s*birth|date\s*de\s*naissance|geburtsdatum)$/i.test(h.text)))continue;
    if(others.length&&field!=='birth_place')continue;
    const last=labels[labels.length-1];
    const tail=line.slice(last.end).replace(/^\s*\(\d{1,2}\)\s*/u,'').trim();
    // Slash-delimited unreadable translations are not values, even if alphabetic.
    const translation=/^[/|]/u.test(tail);
    const composite=others.length>0;
    const normalizeRow=(raw:string)=>{
      let s=raw.trim();
      if(mrz(s))return;
      if(composite){
        const dateHit=date.exec(s);
        if(dateHit)s=s.slice(dateHit[0].length).trim();
        s=s.replace(/^[MFX<]\s+/i,'').replace(/\s+[MFX<]$/i,'');
      }
      return cleanValue(s,field);
    };
    let value=!translation&&tail?normalizeRow(tail):undefined;
    let rule:PrintedCandidate['rule']=composite?'composite':'inline';
    if(!value){
      let next=lines[i+1]??'';
      if(composite&&(sex.test(next)||dateOnly(next)))next=lines[i+2]??'';
      // Never cross another field header, pass separator or MRZ.
      value=normalizeRow(next);
      rule=composite?'composite':'next-line';
    }
    if(value)out.push({field,value,rule});
  }
  return out;
}

/** All proposals must still be checked in the existing scan review. */
export function splitPrintedMotherName(value?:string|null):{mother_family_name:string;mother_given_name:string|null}|undefined {
  const words=value?.trim().split(/\s+/).filter(Boolean);
  return words?.length?{mother_family_name:words[0],mother_given_name:words.slice(1).join(' ')||null}:undefined;
}

export type PrintedValueRead={value:string;confidence?:number|null};
export function choosePrintedValue(reads:PrintedValueRead[]): {value:string;status:'agreed'|'single reading'}|undefined {
  const key=(s:string)=>foldPrinted(s).replace(/[^\p{L}\p{N}]/gu,'');
  const accents=(s:string)=>(s.normalize('NFD').match(/\p{M}/gu)??[]).length;
  const groups=new Map<string,{value:string;count:number;confidence:number}>();
  for(const read of reads){
    const k=key(read.value);
    if(!k)continue;
    const prev=groups.get(k);
    groups.set(k,{value:prev&&accents(prev.value)>=accents(read.value)?prev.value:read.value,count:(prev?.count??0)+1,confidence:Math.max(prev?.confidence??-1,read.confidence??-1)});
  }
  const ranked=[...groups.values()].sort((a,b)=>b.count-a.count||b.confidence-a.confidence);
  if(!ranked.length||ranked.length>1&&ranked[0].count===ranked[1].count&&ranked[0].confidence===ranked[1].confidence)return;
  return {value:ranked[0].value,status:ranked[0].count>1?'agreed':'single reading'};
}

export function splitPrintedBirthName(raw:string,givenName?:string,hungarian=false):{birth_last_name:string;birth_first_name:string}|undefined {
  const pair=raw.split(/\s*,\s*|\s+\/\s+/);
  if(pair.length===2 && pair.every(s=>s.trim()))return {birth_last_name:titlePrinted(pair[0]),birth_first_name:titlePrinted(pair[1])};
  const words=raw.trim().split(/\s+/);
  const known=foldPrinted(givenName??'').replace(/[^a-z ]/g,'').trim();
  let split=words.findIndex((_,i)=>i>0&&!!known&&foldPrinted(words.slice(i).join(' '))===known);
  if(split<1)split=words.length===2||hungarian&&words.length>2?1:-1;
  if(split<1)return;
  return {birth_last_name:titlePrinted(words.slice(0,split).join(' ')),birth_first_name:titlePrinted(words.slice(split).join(' '))};
}
