import { ISO3_TO_ISO2, iso3ToIso2 } from '../../../supabase/functions/_shared/viza/country';
import type { MrzReadResult } from './mrz';
import { normalizeVisibleIdText } from './idFront';
import { printedHungarianIdNumber } from './scanReview';
import { harmonizeNameAccents, restoreDocumentNames } from './nameAccents';
import { resolvePrintedLabels, titlePrinted, splitPrintedBirthName, choosePrintedValue } from './printedLabels';

export type OpticalGuestFields = Partial<{
  first_name: string; last_name: string; birth_first_name: string; birth_last_name: string;
  mother_name: string; birth_place: string; nationality: string; id_document_number: string; date_of_birth: string;
}>;

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const displayName = (s: string) => s.trim().split(/\s+/).map(word => word.toLowerCase().replace(/(^|[-'’])\p{L}/gu, c => c.toUpperCase())).join(' ');
const name = (s: string) => /^[\p{L}\p{M}][\p{L}\p{M} .'’\-]{0,79}$/u.test(s) ? displayName(s) : null;

// Explicit field labels only. Never infer a maiden name from the current
// surname, nationality from the issuing country, or birthplace from an address.
const labels = [
  ['mother_name', /(?:anyja\s+(?:szuletesi\s+)?(?:csalad(?:i)?\s+es\s+uto(?:neve|nev)|neve?)|mother(?:['’]s|s)?\s+(?:(?:birth|maiden)\s+name|(?:family name and given names? at birth)))/i],
  ['birth_pair', /(?:szuletesi\s+csalad(?:i)?\s+es\s+uto(?:neve|nev)|family name and given names? at birth|szuletesi\s+neve?|birth name|^\s*name at birth)/i],
  ['birth_last_name', /(?:szuletesi\s+csalad(?:i)?nev|family name at birth|birth surname|surname at birth)/i],
  ['birth_first_name', /(?:szuletesi\s+uto(?:neve|nev)|given names? at birth|birth given names?)/i],
  ['birth_place', /(?:szuletesi\s+helye?|place of birth|birth place)/i],
  ['nationality', /(?:allampolgarsag|nationality|citizenship)/i],
  ['last_name', /(?:^\s*(?:csalad(?:i)?nev|surname|family name))\b/i],
  ['first_name', /(?:^\s*(?:utonev|given names?))\b/i],
] as const;
const otherLabel = /(?:document\s*(?:no|number)|okmany|date of|szuletesi ido|ervenyes|expiry|signature|alairas|sex|nem\b|can\b|address|lakcim|authority|hat osag)/i;
// Remove only recognized French translations and numbered labels, not values.
const passportFrenchLabel = /\s*\/\s*(?:nom|pr[eé]noms?|nationalit[eé]|date de naissance|sexe|lieu de naissance|date de d[eé]livrance|autorit[eé]|date d['’]expiration|signature du titulaire)(?=\s|[:()/\-]|$)/giu;
const passportNumberedLabel = /\s*\(\s*\d{1,2}\s*\)/g;
const forbiddenPassportHeader = /\b(?:authority|autorite|issuing authority|hatosag|kiallito|date of issue|date of expiry|date of expiration|date de delivrance|date d['’]expiration)\b/i;
function cleanPassportLabel(line: string): string {
  if (!/(?:surname|given names?|nationality|date of birth|sex|place of birth|date of issue|authority|date of expiry|signature)/i.test(line)) return line;
  return line.replace(passportFrenchLabel, '').replace(passportNumberedLabel, '').trim();
}
const knownAlpha2 = new Set(Object.values(ISO3_TO_ISO2));

export function recognizedNationality(code: string | null | undefined): string | null {
  const mapped = iso3ToIso2(code);
  return mapped && knownAlpha2.has(mapped) ? mapped : null;
}

function nationalityValue(value: string): string | null {
  const code = value.trim().toUpperCase();
  if (/^[A-Z]{2,3}$/.test(code)) return recognizedNationality(code);
  if (/^(?:magyar|hungarian|hungary|magyarorszag)$/.test(fold(value.trim()))) return 'HU';
  return null;
}

export function extractOpticalGuestFields(text: string, context?: { givenName?: string; hungarian?: boolean }): OpticalGuestFields {
  const lines = text.split(/\r?\n/).map(x => cleanPassportLabel(x.trim())).filter(Boolean);
  const values = new Map<string, Set<string>>();
  const add = (key: string, value: string | null) => {
    if (!value) return;
    const set = values.get(key) ?? new Set<string>();
    set.add(value); values.set(key, set);
  };
  for (let i = 0; i < lines.length; i++) {
    const normalized = fold(lines[i]);
    if (forbiddenPassportHeader.test(normalized)) continue;
    const label = labels.find(([, pattern]) => pattern.test(normalized));
    if (!label || /^[A-Z0-9<]{25,}$/.test(lines[i])) continue;
    const [key, pattern] = label;
    // Optional printed fields are resolved by the shared label parser below.
    if (key !== 'nationality' && key !== 'first_name' && key !== 'last_name') continue;
    const match = pattern.exec(normalized)!;
    // Ignore composite fields and crowded multi-column OCR lines rather than
    // assign one person's name or date to a different field.
    if (key === 'last_name' || key === 'first_name') {
      if (/(?:at birth|szuletesi|and given|es utonev)/.test(normalized)) continue;
    }
    let tail = lines[i].slice(match.index + match[0].length).replace(/^\s*[:/\-]\s*/, '').trim();
    // Bilingual headers may repeat the same field label in English.
    const repeated = labels.find(([k, p]) => k === key && p.test(fold(tail)));
    if (repeated) {
      const m = repeated[1].exec(fold(tail))!;
      if (m.index === 0) tail = tail.slice(m[0].length).replace(/^\s*[:/\-]\s*/, '').trim();
    }
    const foldedTail = fold(tail);
    if (labels.some(([, p]) => p.test(foldedTail)) || otherLabel.test(foldedTail)) continue;
    if (!tail) {
      const next = lines[i + 1] ?? '';
      if (labels.some(([, p]) => p.test(fold(next))) || otherLabel.test(fold(next)) || forbiddenPassportHeader.test(fold(next))) continue;
      // Do not accidentally consume a machine-readable line as a name.
      if (next.includes('<')) continue;
      tail = next;
    }
    if (key === 'nationality') add(key, nationalityValue(tail));
    else add(key, name(tail));
  }
  for (const candidate of resolvePrintedLabels(text)) {
    if (candidate.field === 'birth_pair') {
      const pair = splitPrintedBirthName(candidate.value, context?.givenName, context?.hungarian);
      if (pair) { add('birth_last_name', pair.birth_last_name); add('birth_first_name', pair.birth_first_name); }
    } else add(candidate.field, titlePrinted(candidate.value));
  }
  // Printed birth dates and nationality often share a crowded bilingual
  // line. Read the value only after a recognizable field label, not after
  // the issuing-country heading, expiry date or a generic country token.
  for (let i=0;i<lines.length;i++) {
    const line=fold(lines[i]);
    if (forbiddenPassportHeader.test(line)) continue;
    const dateLabel=/(?:szuletesi\s*ido|date\s*of\s*birth)/.exec(line);
    if(dateLabel) {
      const tail=line.slice(dateLabel.index+dateLabel[0].length);
      const candidate=tail.match(/\b(\d{2})[.\s/-]+(\d{2})[.\s/-]+(\d{4})\b/) ??
        (!/\d/.test(tail) ? lines[i+1]?.match(/^\s*(\d{2})[.\s/-]+(\d{2})[.\s/-]+(\d{4})\s*$/) : null);
      if(candidate) {
        const [,day,month,year]=candidate;
        const iso=year+'-'+month+'-'+day;
        const d=new Date(iso+'T00:00:00Z');
        if(+year>=1900 && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10)===iso && iso<=new Date().toISOString().slice(0,10)) add('date_of_birth',iso);
      }
    }
    const countryLabel=/(?:allampolgarsag|polg[ae]rsag|nationality|citizenship)/.exec(line);
    if(countryLabel) {
      const tail=line.slice(countryLabel.index+countryLabel[0].length);
      const match=tail.match(/\b([a-z]{3})\s*[.|]*$/);
      if(match) add('nationality',recognizedNationality(match[1]));
    }
  }
  const out: OpticalGuestFields = {};
  for (const [key, candidates] of values) if (candidates.size === 1) (out as Record<string,string>)[key] = [...candidates][0];
  return out;
}

export function opticalGuestFields(result: MrzReadResult, front: string, back: string): OpticalGuestFields {
  const f = result.fields;
  const context = { givenName: f.mrzFirstName, hungarian: f.documentType === 'id_card' && f.issuingState === 'HUN' };
  const a = extractOpticalGuestFields(front, context);
  const b = extractOpticalGuestFields(back, context);
  const out: OpticalGuestFields = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const k = key as keyof OpticalGuestFields;
    if (a[k] && b[k] && a[k] !== b[k]) continue;
    out[k] = a[k] || b[k];
  }
  // Evaluate optional printed data per independent pass; accents are not conflicts.
  const optional = ['birth_place','birth_last_name','birth_first_name','mother_name'] as const;
  const passes = [front, back].flatMap(t=>t.split('\n--- OCR PASS ---\n')).filter(t=>t.trim()).map(t=>extractOpticalGuestFields(t,context));
  for (const key of optional) {
    const reads = passes.flatMap(p=>p[key]?[{value:p[key]!}]:[]);
    const chosen = choosePrintedValue(reads);
    if (chosen) out[key] = chosen.value;
    else delete out[key];
  }
  // For Hungarian IDs, independently labeled printed number can correct
  // a misread MRZ value, but only as a reviewed form suggestion.
  if (f.documentType === 'id_card' && (f.nationalityIso3 === 'HUN' || f.issuingState === 'HUN')) {
    const number = printedHungarianIdNumber(front);
    if (number) out.id_document_number = number;
  }
  // Current names can restore accents when they match the MRZ spelling.
  for (const [key, mrz] of [['first_name', f.mrzFirstName], ['last_name', f.mrzLastName]] as const) {
    if (out[key] && normalizeVisibleIdText(out[key]!) !== normalizeVisibleIdText(mrz)) delete out[key];
  }
  // The printed name anywhere on the document (e.g. the Hungarian card's
  // "Családi és utónév" line) adds the accents the code lines cannot carry.
  // The code-line letters stay; see nameAccents.ts.
  const hungarian = f.nationalityIso3 === 'HUN' || f.issuingState === 'HUN';
  Object.assign(out, restoreDocumentNames(f.mrzLastName, f.mrzFirstName, [front, back], hungarian,
    [a.last_name, a.first_name, b.last_name, b.first_name].filter((v): v is string => !!v)));
  // A partial birth surname is a printed fact. On a valid scan only, offer
  // the current given name as an editable proposal requiring the normal scan review.
  if (out.birth_last_name && !out.birth_first_name && result.valid && !result.unknownCountry && f.firstName) {
    out.birth_first_name = f.firstName;
  }
  if ((!out.birth_first_name || !out.birth_last_name) && (!result.valid || result.unknownCountry)) {
    delete out.birth_first_name; delete out.birth_last_name;
  }
  return harmonizeNameAccents(out, hungarian);
}

/** Form population only: do not mutate or enrich the frozen MRZ payload. */
export function guestScanPatch(result: MrzReadResult, optical: OpticalGuestFields = {}): OpticalGuestFields & {
  date_of_birth?: string; gender?: string; id_document_type: string;
} {
  const f = result.fields;
  // Global unknownCountry also includes an unreadable *issuer*. The
  // nationality code is independent and should still fill a known ISO code.
  const nationality = recognizedNationality(f.nationalityIso3) ?? recognizedNationality(f.nationality);
  return {
    ...(f.firstName ? { first_name: f.firstName } : {}),
    ...(f.lastName ? { last_name: f.lastName } : {}),
    ...(nationality ? { nationality } : {}),
    ...(f.dateOfBirth ? { date_of_birth: f.dateOfBirth } : {}),
    ...(f.gender ? { gender: f.gender } : {}),
    id_document_type: f.documentType,
    ...(f.documentNumber ? { id_document_number: f.documentNumber } : {}),
    ...optical,
  };
}
