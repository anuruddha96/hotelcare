/**
 * Machine Readable Zone (MRZ) reading for guest ID documents (ICAO 9303).
 *
 * Pure functions, no I/O: OCR output in, guest-form fields out. The camera
 * image never leaves the device — only the text lines OCR'd from it are used,
 * and nothing here stores them.
 *
 * Supported: TD3 (passports, 2×44), TD1 (ID cards, 3×30), TD2 (2×36).
 */
import { parse } from 'mrz';

export interface MrzGuestFields {
  firstName: string;
  lastName: string;
  /** ISO 3166-1 alpha-3 as printed in the MRZ, e.g. "HUN" (VIZA uses 3-letter codes). */
  nationality: string;
  /** YYYY-MM-DD */
  dateOfBirth: string | null;
  gender: 'male' | 'female' | 'other' | null;
  documentType: 'passport' | 'id_card';
  documentNumber: string;
  /** YYYY-MM-DD */
  expiryDate: string | null;
  issuingState: string;
}

export interface MrzReadResult {
  fields: MrzGuestFields;
  /** All ICAO check digits and field rules passed. If false, staff must verify every field. */
  valid: boolean;
  /** Country code not in the ISO list (misread, or a specimen); staff should check it. */
  unknownCountry: boolean;
  format: 'TD1' | 'TD2' | 'TD3';
  lines: string[];
}

const MRZ_CHARS = /^[A-Z0-9<]+$/;
const LENGTHS = { TD1: 30, TD2: 36, TD3: 44 } as const;

/**
 * Clean one OCR line: uppercase, drop spaces, map look-alike characters
 * OCR commonly confuses with the MRZ filler '<' (e.g. '«', 'K<' runs stay).
 */
export function normalizeMrzLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s\u00A0]/g, '')
    .replace(/[«‹＜]/g, '<')
    .replace(/[^A-Z0-9<]/g, '');
}

/** Pick the MRZ lines out of free OCR text (other printed text is ignored). */
export function extractMrzLines(ocrText: string): { format: 'TD1' | 'TD2' | 'TD3'; lines: string[] } | null {
  const candidates = ocrText
    .split(/\r?\n/)
    .map(normalizeMrzLine)
    .filter((line) => line.length >= 28 && MRZ_CHARS.test(line) && line.includes('<'));

  const fit = (line: string, len: number) =>
    line.length === len ? line : line.length > len ? line.slice(0, len) : line.padEnd(len, '<');

  // Prefer the format whose length matches best, scanning from the bottom (MRZ is printed last).
  for (const format of ['TD3', 'TD1', 'TD2'] as const) {
    const len = LENGTHS[format];
    const rows = format === 'TD1' ? 3 : 2;
    const near = candidates.filter((line) => Math.abs(line.length - len) <= 2);
    if (near.length >= rows) {
      const lines = near.slice(-rows).map((line) => fit(line, len));
      // A document line starts with P, I, A, C or V.
      if (/^[PIACV]/.test(lines[0])) return { format, lines };
    }
  }
  return null;
}

/** YYMMDD → YYYY-MM-DD. Birth dates never lie in the future; expiry dates may. */
export function mrzDate(yymmdd: string | null | undefined, kind: 'birth' | 'expiry', today = new Date()): string | null {
  if (!yymmdd || !/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const thisYY = today.getFullYear() % 100;
  let century: number;
  if (kind === 'birth') century = yy > thisYY ? 1900 : 2000;
  else century = yy < thisYY - 30 ? 2100 : 2000;
  const iso = `${century + yy}-${mm}-${dd}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

const clean = (value: unknown) => String(value ?? '').replace(/</g, ' ').replace(/\s+/g, ' ').trim();
const title = (value: string) => value.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

/** Read OCR text and return guest fields, or null if no MRZ could be found. */
export function readMrz(ocrText: string, today = new Date()): MrzReadResult | null {
  const found = extractMrzLines(ocrText);
  if (!found) return null;
  let result: ReturnType<typeof parse>;
  try {
    result = parse(found.lines, { autocorrect: true });
  } catch {
    return null;
  }
  const f = result.fields as Record<string, string | null>;
  const failures = (result.details ?? []).filter((d) => !d.valid);
  const countryOnly = (d: { error?: string }) => /state code/i.test(String(d.error ?? ''));
  const docCode = String(f.documentCode ?? '').charAt(0);
  // Country codes sit at fixed positions; read them directly when the parser
  // blanks a code it does not recognise, so staff can still see and fix it.
  const [l1, l2] = found.lines;
  const rawIssuer = clean(l1.slice(2, 5));
  const rawNationality = clean(found.format === 'TD1' ? l2.slice(15, 18) : l2.slice(10, 13));
  const sex = f.sex === 'male' ? 'male' : f.sex === 'female' ? 'female' : f.sex ? 'other' : null;
  return {
    format: found.format,
    lines: found.lines,
    valid: failures.every(countryOnly),
    unknownCountry: failures.some(countryOnly),
    fields: {
      firstName: title(clean(f.firstName)),
      lastName: title(clean(f.lastName)),
      nationality: (clean(f.nationality) || rawNationality).toUpperCase(),
      dateOfBirth: mrzDate(f.birthDate, 'birth', today),
      gender: sex,
      documentType: docCode === 'P' ? 'passport' : 'id_card',
      documentNumber: clean(f.documentNumber).replace(/\s/g, ''),
      expiryDate: mrzDate(f.expirationDate, 'expiry', today),
      issuingState: (clean(f.issuingState) || rawIssuer).toUpperCase(),
    },
  };
}
