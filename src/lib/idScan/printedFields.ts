/**
 * Printed (non-code-line) fields on the back of an ID card:
 * place of birth, name at birth, mother's maiden name.
 *
 * On these cards the labels are in mixed case ("Születési hely/Place of
 * birth:") and the values in CAPITALS on the next line. A value is assigned
 * to a field by the label above it; for the Hungarian layout the fixed row
 * order is the fallback when a label is too small to read.
 *
 * Small print is easy to misread, so nothing is proposed from a single
 * reading: at least two independent readings must agree.
 */
import type { OpticalGuestFields } from './opticalGuestFields';
import { resolvePrintedLabels, stripBirthCountry, titlePrinted } from './printedLabels';

export type PrintedField = 'birth_place' | 'birth_name' | 'mother_name';
export type PrintedRead = Partial<Record<PrintedField, string>>;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LETTERS = /[^A-Za-zÀ-ɏ\-'.]/g;

/** Leading run of CAPITAL words; stray OCR marks after the value are dropped. */
export function capitalValue(line: string): string | null {
  const out: string[] = [];
  for (const token of line.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    if (out.length && /^\([A-Z]{3}\)[.,;:]?$/.test(token)) { out.push(token.replace(/[.,;:]$/, '')); continue; }
    const core = token.replace(LETTERS, '').replace(/^[-'.]+|[-'.]+$/g, '');
    if (core.length >= 2 && core === core.toUpperCase() && /\p{Lu}/u.test(core)) out.push(core);
    else if (out.length) break;
    else return null;
  }
  return out.length ? out.join(' ') : null;
}

function labelField(line: string): PrintedField | 'stop' | null {
  const f = fold(line);
  if (/any|moth|maid/.test(f)) return 'mother_name';
  if (/hely|plac/.test(f) && !/name|csal/.test(f)) return 'birth_place';
  if (/csal|uton|given|name at|at b.rth/.test(f)) return 'birth_name';
  if (/hatos|author|issu|kiall/.test(f)) return 'stop';
  return null;
}

/** One OCR reading of the printed zone -> labelled values. */
export function parsePrintedText(text: string, hungarianLayout: boolean): PrintedRead {
  const out: PrintedRead = {};
  for (const candidate of resolvePrintedLabels(text)) {
    const field = candidate.field === 'birth_pair' ? 'birth_name' : candidate.field;
    if (field === 'birth_place' || field === 'birth_name' || field === 'mother_name') {
      out[field] ??= candidate.value;
    }
  }
  // Retain the old noisy-label/row-order fallback only on the confirmed Hungarian layout.
  if (!hungarianLayout) return out;
  const values: string[] = [];
  let field: PrintedField | null = null;
  for (const line of text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const value = line.includes(':') ? null : capitalValue(line);
    if (value === null) {
      const label = labelField(line);
      if (label === 'stop') break;
      field = label;
      continue;
    }
    values.push(value);
    if (field && !out[field]) out[field] = value;
    field = null;
  }
  // Hungarian card: place of birth "(HUN)", then name at birth, then mother.
  if (hungarianLayout && values.length >= 3 && /\([A-Z]{3}\)$/.test(values[0])) {
    (['birth_place', 'birth_name', 'mother_name'] as const).forEach((key, i) => { out[key] ??= values[i]; });
  }
  if (out.birth_place) out.birth_place = stripBirthCountry(out.birth_place);
  for (const key of Object.keys(out) as PrintedField[]) {
    const v = out[key]!;
    if (v.length < 2 || v.length > (key === 'birth_place' ? 200 : 80)) delete out[key];
  }
  return out;
}

/** Keep a value only when at least two readings agree (accents aside).
 * Readings may carry stray capitals after the value, so the longest run of
 * leading words shared by two readings is what counts. Small accents are
 * dropped by OCR far more often than invented: among agreeing spellings the
 * one with the most accented letters is kept. */
export function agreePrinted(reads: PrintedRead[]): PrintedRead {
  const out: PrintedRead = {};
  const accents = (v: string) => (v.normalize('NFD').match(/[\u0300-\u036f]/g) ?? []).length;
  for (const key of ['birth_place', 'birth_name', 'mother_name'] as const) {
    const seen = reads.map(r => r[key]).filter((v): v is string => !!v).map(v => v.split(' '));
    const minimum = key === 'birth_place' ? 1 : 2;
    let best: string[] | null = null;
    for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
      let n = 0;
      while (n < seen[i].length && n < seen[j].length && fold(seen[i][n]) === fold(seen[j][n])) n++;
      if (n < minimum || (best && n <= best.length)) continue;
      best = seen[i].slice(0, n).map((word, k) => accents(seen[j][k]) > accents(word) ? seen[j][k] : word);
      // A third reading may still restore an accent.
      for (const other of seen) {
        if (other.length >= n && other.slice(0, n).every((w, k) => fold(w) === fold(best![k]))) {
          best = best.map((word, k) => accents(other[k]) > accents(word) ? other[k] : word);
        }
      }
    }
    if (best) out[key] = best.join(' ');
  }
  return out;
}

const title = titlePrinted;

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * Agreed printed values -> guest form proposals.
 * Hungarian order is family name first. The code lines' given name is used
 * only as a check: a birth given name that is almost, but not exactly, the
 * code-line given name is a misreading and is left for staff to type.
 */
export function printedGuestFields(read: PrintedRead, mrzGivenName: string): OpticalGuestFields {
  const out: OpticalGuestFields = {};
  if (read.birth_place) out.birth_place = title(read.birth_place);
  if (read.mother_name) out.mother_name = title(read.mother_name);
  if (read.birth_name) {
    const words = read.birth_name.split(' ');
    const given = fold(mrzGivenName).replace(/[^a-z ]/g, '').trim();
    let split = 1;
    // Compound family names: split where the code-line given name starts.
    for (let i = 1; i < words.length; i++) {
      if (given && fold(words.slice(i).join(' ')) === given) { split = i; break; }
    }
    const first = words.slice(split).join(' '), last = words.slice(0, split).join(' ');
    const d = given ? distance(fold(first), given) : 0;
    const nearMiss = d > 0 && d <= 2 && given.length >= 4;
    if (first && last && !nearMiss) { out.birth_last_name = title(last); out.birth_first_name = title(first); }
  }
  return out;
}
