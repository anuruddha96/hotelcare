import { ISO3_TO_ISO2, iso3ToIso2 } from '../../../supabase/functions/_shared/viza/country';
import type { MrzReadResult } from './mrz';
import { normalizeVisibleIdText } from './idFront';
import { printedHungarianIdNumber } from './scanReview';

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

export function extractOpticalGuestFields(text: string): OpticalGuestFields {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const values = new Map<string, Set<string>>();
  const add = (key: string, value: string | null) => {
    if (!value) return;
    const set = values.get(key) ?? new Set<string>();
    set.add(value); values.set(key, set);
  };
  for (let i = 0; i < lines.length; i++) {
    const normalized = fold(lines[i]);
    const label = labels.find(([, pattern]) => pattern.test(normalized));
    if (!label || /^[A-Z0-9<]{25,}$/.test(lines[i])) continue;
    const [key, pattern] = label;
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
      if (labels.some(([, p]) => p.test(fold(next))) || otherLabel.test(fold(next))) continue;
      // Do not accidentally consume a machine-readable line as a name.
      if (next.includes('<')) continue;
      tail = next;
    }
    if (key === 'nationality') add(key, nationalityValue(tail));
    else if (key === 'birth_pair') {
      // Only split an explicitly separated pair; no guess for multi-part names.
      const pair = tail.split(/\s*,\s*|\s+\/\s+/);
      if (pair.length === 2) { add('birth_last_name', name(pair[0])); add('birth_first_name', name(pair[1])); }
      else if (tail.split(/\s+/).length === 2) {
        const parts = tail.split(/\s+/);
        add('birth_last_name', name(parts[0])); add('birth_first_name', name(parts[1]));
      }
    } else if (key === 'mother_name') {
      if (tail.split(/\s+/).length >= 2) add(key, name(tail));
    } else if (key === 'birth_place') {
      // Hungarian specimen prints the town followed by (HUN). Keep the
      // birthplace text, never infer nationality from a birthplace suffix.
      add(key, name(tail.replace(/\s*\([A-Z]{2,3}\)\s*$/i, '').trim()));
    } else add(key, name(tail));
  }
  // Printed birth dates and nationality often share a crowded bilingual
  // line. Read the value only after a recognizable field label, not after
  // the issuing-country heading, expiry date or a generic country token.
  for (let i=0;i<lines.length;i++) {
    const line=fold(lines[i]);
    // Passport layouts often put Sex and Place of birth on the same row,
    // followed by a bilingual label and then a sex marker + printed place.
    // Never infer the place from the issuing state or MRZ.
    if (/\b(?:sex|sexe)\b/.test(line) && /\bplace\s+of\s+birth\b/.test(line)) {
      const placeLabel = /place\s+of\s+birth(?:\s*\/\s*lieu\s+de\s+naissance)?/.exec(line);
      if (placeLabel) {
        const rest = lines[i].slice(placeLabel.index + placeLabel[0].length).trim();
        const candidate = rest || (lines[i + 1] ?? '').replace(/^[MFX]\s+/i, '').trim();
        if (candidate && !otherLabel.test(fold(candidate)) && !labels.some(([, p]) => p.test(fold(candidate)))) add('birth_place', name(candidate));
      }
    }
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
  const a = extractOpticalGuestFields(front);
  const b = extractOpticalGuestFields(back);
  const out: OpticalGuestFields = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const k = key as keyof OpticalGuestFields;
    if (a[k] && b[k] && a[k] !== b[k]) continue;
    out[k] = a[k] || b[k];
  }
  const f = result.fields;
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
  // A complete birth-name pair is required by the existing VIZA validator.
  if (!out.birth_first_name || !out.birth_last_name) {
    delete out.birth_first_name; delete out.birth_last_name;
  }
  return out;
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
