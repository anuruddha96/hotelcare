/**
 * Accents for names read from an ID card or passport.
 *
 * The machine-readable code lines cannot carry accents (ICAO 9303:
 * Á→A, É→E, Ő→O, Ü→U or UE …). The same name is also printed on the
 * document with its accents. The code lines decide every letter; a printed
 * reading may only add the accent to a letter the code lines already have,
 * at a place where the printed reading matches the code lines around it.
 * Readings that do not match the code-line spelling are ignored, so a
 * misread printed letter can never change the name.
 *
 * Nothing here is stored: it works on OCR text held in memory during a scan.
 */
import { HUNGARIAN_GIVEN_NAMES } from './hungarianGivenNames';

type Unit = { base: string; src: number; lead: boolean; marked: boolean };
type Proposal = { char: string; consume: number };

// Letters that NFD does not decompose, and the German/Nordic code-line spellings.
const SPECIAL: Record<string, string> = { Ł: 'L', Ø: 'O', Đ: 'D', Ð: 'D', Ħ: 'H', Ŀ: 'L', Ŧ: 'T', ẞ: 'SS', Æ: 'AE', Œ: 'OE', Þ: 'TH' };
const TRANSLIT: Record<string, string> = { Ä: 'AE', Ö: 'OE', Ü: 'UE', Å: 'AA', Ø: 'OE' };
// Characters OCR often returns for capital letters; used only for comparison.
const LOOKALIKE: Record<string, string> = { '0': 'O', '1': 'I', '|': 'I', l: 'I', '5': 'S', '8': 'B' };
const HUNGARIAN_ACCENTED = new Set([...'ÁÉÍÓÖŐÚÜŰ']);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const accents = (s: string) => [...s.normalize('NFC')].filter(c => c.charCodeAt(0) > 127).length;

/** Code-line spelling: capitals A–Z, one space between words. */
export function codeLineName(name: string | null | undefined): string {
  return String(name ?? '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
}

function toUnits(text: string, translit: boolean): { chars: string[]; units: Unit[] } {
  const chars = [...text.normalize('NFC')];
  const units: Unit[] = [];
  chars.forEach((raw, src) => {
    const ch = LOOKALIKE[raw] ?? raw;
    if (/[\s<\-'’.,:;/]/.test(ch)) {
      if (units.length && units[units.length - 1].base !== ' ') units.push({ base: ' ', src, lead: true, marked: false });
      return;
    }
    const up = ch.toUpperCase();
    const base = (translit ? TRANSLIT[up] : undefined) ?? SPECIAL[up] ?? up.normalize('NFD')[0];
    if (!/^[A-Z]+$/.test(base)) return;
    [...base].forEach((b, k) => units.push({ base: b, src, lead: k === 0, marked: up !== base }));
  });
  while (units.length && units[units.length - 1].base === ' ') units.pop();
  return { chars, units };
}

/** Best place of the code-line name inside one printed line (free start and end). */
function align(target: string, units: Unit[]): { distance: number; pairs: Map<number, number> } {
  const a = [...target], n = a.length, m = units.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => new Array<number>(m + 1).fill(i));
  for (let j = 0; j <= m; j++) d[0][j] = 0;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1] === units[j - 1].base ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  }
  let end = 0;
  for (let j = 1; j <= m; j++) if (d[n][j] < d[n][end]) end = j;
  const pairs = new Map<number, number>();
  let i = n, j = end;
  while (i > 0 && j > 0) {
    const same = a[i - 1] === units[j - 1].base;
    if (d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) { if (same) pairs.set(i - 1, j - 1); i--; j--; }
    else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return { distance: d[n][end], pairs };
}

/** Accents one printed line proposes for the code-line name, by position. */
function proposals(target: string, line: string, hungarian: boolean): Map<number, Proposal> | null {
  if (!line.trim() || line.length > 160) return null;
  const letters = target.replace(/ /g, '').length;
  let best: { distance: number; pairs: Map<number, number>; units: Unit[]; chars: string[] } | null = null;
  for (const translit of hungarian ? [false] : [false, true]) {
    const { chars, units } = toUnits(line, translit);
    if (!units.length) continue;
    const r = align(target, units);
    if (!best || r.distance < best.distance) best = { ...r, units, chars };
  }
  if (!best || best.distance > Math.max(1, Math.round(letters * 0.3))) return null;
  const { pairs, units, chars } = best;
  const a = [...target];
  const out = new Map<number, Proposal>();
  for (const [i, j] of pairs) {
    const u = units[j];
    if (!u.marked || !u.lead || a[i] === ' ') continue;
    // The printed letters next to it must match the code lines too.
    const prevOk = i > 0 && a[i - 1] !== ' ' && pairs.get(i - 1) === j - 1;
    const nextOk = i + 1 < a.length && a[i + 1] !== ' ' && pairs.has(i + 1);
    const single = (i === 0 || a[i - 1] === ' ') && (i + 1 === a.length || a[i + 1] === ' ');
    if (!prevOk && !nextOk && !single) continue;
    const char = chars[u.src].toUpperCase();
    // A two-letter code-line spelling (UE for Ü) needs both letters matched.
    const width = [...((TRANSLIT[char] && units[j + 1]?.src === u.src && !units[j + 1].lead) ? TRANSLIT[char] : (SPECIAL[char] ?? 'x'))].length;
    if (width > 1) {
      let ok = true;
      for (let k = 1; k < width; k++) if (pairs.get(i + k) !== j + k || units[j + k]?.src !== u.src) ok = false;
      if (!ok) continue;
    }
    if (hungarian && !HUNGARIAN_ACCENTED.has(char)) continue;
    out.set(i, { char, consume: width });
  }
  return out;
}

/**
 * The code-line name with the accents the printed readings agree on.
 * Returns null when no reading matched the code-line spelling.
 */
export function accentedFromReadings(codeName: string, readings: string[], hungarian = false): string | null {
  const target = codeLineName(codeName);
  if (target.replace(/ /g, '').length < 2) return null;
  const votes = new Map<number, Set<string>>();
  const widths = new Map<string, number>();
  let matched = false;
  for (const line of readings) {
    const p = proposals(target, line, hungarian);
    if (!p) continue;
    matched = true;
    for (const [i, { char, consume }] of p) {
      const set = votes.get(i) ?? new Set<string>();
      set.add(char); votes.set(i, set); widths.set(i + ':' + char, consume);
    }
  }
  if (!matched) return null;
  const a = [...target];
  let out = '';
  for (let i = 0; i < a.length; i++) {
    const set = votes.get(i);
    if (set && set.size === 1) {
      const char = [...set][0];
      out += char;
      i += (widths.get(i + ':' + char) ?? 1) - 1;
    } else out += a[i];
  }
  // Safety net: the result must spell exactly the code-line letters.
  const plain = (s: string) => [...s].map(c => SPECIAL[c] ?? TRANSLIT[c] ?? fold(c)).join('');
  if (fold(out) !== target && plain(out) !== target) return null;
  return out;
}

const displayName = (s: string) => s.trim().split(/\s+/).map(w => w.toLowerCase().replace(/(^|[-'’])\p{L}/gu, c => c.toUpperCase())).join(' ');

/** Official Hungarian given names keyed by their unaccented spelling. */
const GIVEN_BY_FOLD = (() => {
  const map = new Map<string, string[]>();
  for (const name of HUNGARIAN_GIVEN_NAMES) {
    const key = fold(name);
    map.set(key, [...(map.get(key) ?? []), name]);
  }
  return map;
})();

/** On a Hungarian document a given name with a misplaced accent is replaced
 * by the only official name with those letters; unknown names stay as read. */
function officialGivenName(word: string): string {
  if (!accents(word)) return word;
  const options = GIVEN_BY_FOLD.get(fold(word));
  if (!options || options.some(o => o.toLowerCase() === word.toLowerCase())) return word;
  return options.length === 1 ? options[0] : word;
}

/**
 * Hungarian married names end in "-né", always written with the accent
 * ("Szépené Kiss", "Nagyné Kovács"). A camera read often misses that accent
 * on the last letter, so on a Hungarian document the first word of a two-word
 * family name that ends in "ne" gets it back, once the reading has shown that
 * the printed name carries accents at all. Short words ("Bene") stay as read.
 */
export function marriedNameSuffix(familyName: string): string {
  const words = familyName.split(' ');
  if (words.length < 2 || !accents(familyName)) return familyName;
  const word = words[0];
  if (fold(word).replace(/[^A-Z]/g, '').length < 5 || !/ne$/i.test(word)) return familyName;
  words[0] = word.slice(0, -1) + (word.endsWith('E') ? 'É' : 'é');
  return words.join(' ');
}

export type DocumentNames = { last_name?: string; first_name?: string };

/**
 * Accented current names from the printed text of the document, matched to
 * the code-line names. Only names that gain an accent are returned.
 */
export function restoreDocumentNames(mrzLastName: string, mrzFirstName: string, texts: string[], hungarian = false, labeledValues: string[] = []): DocumentNames {
  const last = codeLineName(mrzLastName), first = codeLineName(mrzFirstName);
  if (!last || !first) return {};
  const lines = texts.flatMap(t => String(t ?? '').split(/\r?\n/)).map(l => l.trim()).filter(Boolean);
  // ID cards print "FAMILY NAME GIVEN NAME" on one line; passports usually
  // print them on separate lines, so each part is also looked for alone, but
  // only in a line that holds that name and nothing more (or a labeled
  // value), never inside another name such as the mother's.
  const whole = accentedFromReadings(last + ' ' + first, lines, hungarian);
  const alone = (part: string) => {
    const n = part.replace(/ /g, '').length;
    if (n < 3) return null;
    const own = lines.filter(l => { const k = fold(l).replace(/[^A-Z]/g, '').length; return k >= n - 2 && k <= n + 3; });
    return accentedFromReadings(part, [...own, ...labeledValues.filter(Boolean)], hungarian);
  };
  const lastAlone = alone(last);
  const firstAlone = alone(first);
  const lastWords = last.split(' ').length;
  const fromWhole = whole ? { last: whole.split(' ').slice(0, lastWords).join(' '), first: whole.split(' ').slice(lastWords).join(' ') } : null;
  const pick = (a: string | null | undefined, b: string | null | undefined) => (accents(b ?? '') > accents(a ?? '') ? b : a) ?? null;
  const out: DocumentNames = {};
  let l = pick(fromWhole?.last, lastAlone);
  if (l && hungarian) l = marriedNameSuffix(l);
  let f = pick(fromWhole?.first, firstAlone);
  if (f && hungarian) f = f.split(' ').map(officialGivenName).join(' ');
  if (l && accents(l) && fold(l) === last) out.last_name = displayName(l);
  if (f && accents(f) && fold(f) === first) out.first_name = displayName(f);
  return out;
}

type NameFields = Partial<Record<'first_name' | 'last_name' | 'birth_first_name' | 'birth_last_name' | 'mother_name', string>>;

/**
 * The same name written twice on one document (current and birth name,
 * e.g. "Rozália" and "Kiss Rozália") gets the same accents. Hungarian given
 * names with a misplaced accent are matched to the official list.
 */
export function harmonizeNameAccents<T extends NameFields>(fields: T, hungarian = false): T {
  const out = { ...fields };
  const sameWords = (target: string | undefined, source: string | undefined) => {
    if (!target || !source) return target;
    const known = source.split(/\s+/);
    return target.split(/\s+/).map(w => known.find(k => fold(k) === fold(w) && accents(k) > accents(w)) ?? w).join(' ');
  };
  if (out.birth_first_name) out.birth_first_name = sameWords(out.birth_first_name, out.first_name);
  if (out.birth_last_name) out.birth_last_name = sameWords(out.birth_last_name, out.last_name);
  if (hungarian) {
    if (out.last_name) out.last_name = marriedNameSuffix(out.last_name);
    if (out.birth_first_name) out.birth_first_name = out.birth_first_name.split(/\s+/).map(officialGivenName).join(' ');
    if (out.mother_name) {
      const words = out.mother_name.split(/\s+/);
      if (words.length >= 2) out.mother_name = [...words.slice(0, -1), officialGivenName(words[words.length - 1])].join(' ');
    }
  }
  return out;
}
