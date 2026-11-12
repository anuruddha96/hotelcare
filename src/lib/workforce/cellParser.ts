/**
 * Reads one work-schedule cell the way RD Hotels write their Excel roster,
 * and the way people type into the in-app grid.
 *
 *   "08-20", "08:30-14:30", "éjsz, 20-08"     working times (overnight aware)
 *   "SZ", "K", "K/2", "HK", "SV", "L", "PN"    duty codes without times
 *   "SV+1", "K + 1 óra", "+30p"               extra time on top of the shift
 *   "mika", "Otto 20-08", "Memo SZ"           working at another hotel
 *   "B", "FNSZ", "igazolatlan", "HO"          sick, unpaid leave, absent, home office
 *
 * In the workbook the cell colour carries meaning too (red = leave, black =
 * fixed day off, green = Mika, purple = Ottofiori, …). When importing, pass the
 * fill colour; when typing in the app there is no colour, so leave is typed as
 * "SZB" / "szabi" (plain "SZ" means room duty, as in the housekeeping columns).
 *
 * Pure and dependency-free: used by the grid, the tests and the Excel import.
 */

export type WorkforceKind =
  | 'work' | 'night' | 'training' | 'home_office' | 'extra_day'
  | 'leave' | 'half_leave' | 'sick' | 'unpaid_leave' | 'absent'
  | 'day_off' | 'fixed_day_off' | 'other';

export const WORKING_KINDS: ReadonlySet<WorkforceKind> = new Set(['work', 'night', 'training', 'home_office', 'extra_day']);

export interface ParsedCell {
  kind: WorkforceKind;
  code: string | null;
  start: string | null;
  end: string | null;
  dayFraction: number;
  extraMinutes: number;
  hotelId: string | null;
  note: string | null;
  raw: string;
  /** False when the text was not understood and is kept only as a note. */
  confident: boolean;
}

export interface CustomShiftCode {
  code: string;
  kind: WorkforceKind;
  start_time?: string | null;
  end_time?: string | null;
  day_fraction?: number | null;
  hotel_id?: string | null;
}

export interface ParseContext {
  /** Excel fill colour as ARGB/RGB hex (e.g. "FFFF0000"), only when importing. */
  fill?: string | null;
  customCodes?: readonly CustomShiftCode[];
}

export const HOTEL_KEYS = {
  mika: 'mika-downtown',
  otto: 'ottofiori',
  memo: 'memories-budapest',
  gozsdu: 'gozsdu-court',
} as const;

type FillMeaning = 'leave' | 'sick' | 'fixed_off' | 'unpaid' | 'absent' | 'mika' | 'otto' | 'memo' | 'work' | null;

/** What a workbook colour means. Unknown colours are treated as "working". */
export function fillMeaning(fill: string | null | undefined): FillMeaning {
  if (!fill) return null;
  const hex = fill.replace(/^#/, '').toUpperCase().slice(-6);
  if (!/^[0-9A-F]{6}$/.test(hex) || hex === 'FFFFFF') return null;
  switch (hex) {
    case 'FF0000': case 'E06666': return 'leave';
    case 'FFFF00': case 'B6D7A8': return 'sick';
    case '000000': return 'fixed_off';
    case 'FFF2CC': case 'FCE5CD': return 'unpaid';
    case 'FF9900': return 'absent';
    case '00FF00': return 'mika';
    case '9900FF': case 'A64D79': return 'otto';
    case 'FF00FF': return 'memo';
    default: return 'work';
  }
}

export function normalizeCellText(value: string): string {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const pad = (value: number) => String(value).padStart(2, '0');

/** First "H-H" / "HH:MM-HH:MM" range in the text. */
export function readClockRange(text: string): { start: string; end: string } | null {
  const match = text.match(/(?:^|[^\d:.])(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?(?![\d])/);
  if (!match) return null;
  const sh = Number(match[1]), sm = Number(match[2] ?? 0);
  const eh = Number(match[3]), em = Number(match[4] ?? 0);
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null;
  const start = `${pad(sh % 24)}:${pad(sm)}`;
  const end = `${pad(eh % 24)}:${pad(em)}`;
  if (start === end) return null;
  return { start, end };
}

/** "+1", "+1,5", "+30p", "plusz 1 óra", "minusz 1 óra" → minutes. */
export function readExtraMinutes(input: string): number {
  const text = normalizeCellText(input);
  let total = 0;
  const hourRe = /(\+|plusz|minusz)\s*(\d+(?:[.,]\d+)?|fel)\s*(?:ora|o|h)\b/g;
  const minuteRe = /(\+|plusz|minusz)\s*(\d+)\s*(?:p|perc|min)\b/g;
  const consumed: Array<[number, number]> = [];
  const sign = (word: string) => (word === 'minusz' ? -1 : 1);
  for (const m of text.matchAll(hourRe)) {
    const amount = m[2] === 'fel' ? 0.5 : Number(m[2].replace(',', '.'));
    total += sign(m[1]) * Math.round(amount * 60);
    consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of text.matchAll(minuteRe)) {
    total += sign(m[1]) * Number(m[2]);
    consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of text.matchAll(/\+\s*(\d+(?:[.,]\d+)?)/g)) {
    const at = m.index ?? 0;
    if (consumed.some(([from, to]) => at >= from && at < to)) continue;
    total += Math.round(Number(m[1].replace(',', '.')) * 60);
  }
  return Math.max(-720, Math.min(720, total));
}

function locationFromText(text: string): string | null {
  if (/\b(mika|mitico)\b/.test(text)) return HOTEL_KEYS.mika;
  if (/\b(otto|ottofiori)\b/.test(text)) return HOTEL_KEYS.otto;
  if (/\b(memo|memories)\b/.test(text)) return HOTEL_KEYS.memo;
  if (/\bgozsdu\b/.test(text)) return HOTEL_KEYS.gozsdu;
  return null;
}

const DUTY_CODES: Array<[RegExp, string, number?]> = [
  [/\bk\s*\/\s*2\b/, 'K/2', 0.5],
  [/\bk1\b/, 'K1'],
  [/\bk2\b/, 'K2'],
  [/\bsz\b/, 'SZ'],
  [/\bk\b/, 'K'],
  [/\bhk\b/, 'HK'],
  [/\bsv\d?\b/, 'SV'],
  [/\bl\b/, 'L'],
  [/\bpublic( area)?\b/, 'PA'],
  [/\b(karbi|wesi|office|reci|reggeli|kitchen|morning|afternoon|levante|mitico|munka|work)\b/, ''],
];

function baseResult(raw: string): ParsedCell {
  return { kind: 'work', code: null, start: null, end: null, dayFraction: 1, extraMinutes: 0, hotelId: null, note: null, raw, confident: true };
}

/**
 * Interpret one cell. Returns null for an empty cell without meaning
 * (in the workbook an empty, uncoloured cell is an ordinary day off).
 */
export function parseCell(input: string | number | null | undefined, ctx: ParseContext = {}): ParsedCell | null {
  const raw = input === null || input === undefined ? '' : String(input).replace(/\s+/g, ' ').trim();
  const text = normalizeCellText(raw);
  const fill = fillMeaning(ctx.fill);
  if (!text && !fill) return null;

  const result = baseResult(raw);
  const keepNote = () => { if (raw) result.note = raw; };

  // An explicitly configured code always wins.
  const custom = ctx.customCodes?.find((code) => normalizeCellText(code.code) === text);
  if (custom && text) {
    result.kind = custom.kind;
    result.code = custom.code;
    if (custom.start_time && custom.end_time) {
      result.start = custom.start_time.slice(0, 5);
      result.end = custom.end_time.slice(0, 5);
    }
    result.dayFraction = custom.day_fraction ?? 1;
    result.hotelId = custom.hotel_id ?? null;
    return result;
  }

  // Colour meanings that override the text.
  if (fill === 'leave') {
    result.kind = /\b(fel|half)\b/.test(text) ? 'half_leave' : 'leave';
    result.code = 'SZ';
    if (text && !/^sz(ab|abi|abadsag)?$/.test(text)) keepNote();
    if (result.kind === 'half_leave') { const clock = readClockRange(text); if (clock) { result.start = clock.start; result.end = clock.end; } }
    return result;
  }
  if (fill === 'unpaid') { result.kind = 'unpaid_leave'; result.code = 'FNSZ'; if (text && text !== 'fnsz') keepNote(); return result; }
  if (fill === 'fixed_off') { result.kind = 'fixed_day_off'; result.code = null; if (text) keepNote(); return result; }
  if (fill === 'sick' && !readClockRange(text)) { result.kind = 'sick'; result.code = 'B'; if (text && text !== 'b') keepNote(); return result; }
  if (fill === 'absent' && /(igazol|nem jelent|nem jelzett|nem jott|no show)/.test(text)) {
    result.kind = 'absent'; result.code = 'IG'; keepNote(); return result;
  }

  // Text meanings.
  if (/^(b|beteg|betegseg|sick)$/.test(text)) { result.kind = 'sick'; result.code = 'B'; return result; }
  if (/\bfnsz\b|fizetes nelkuli|unpaid/.test(text)) { result.kind = 'unpaid_leave'; result.code = 'FNSZ'; return result; }
  if (/(igazolatlan|nem jelent meg|no show)/.test(text)) { result.kind = 'absent'; result.code = 'IG'; keepNote(); return result; }
  if (/^(szb|szab|szabi|szabadsag|leave|holiday)$/.test(text) || /^(fel nap |fel )?(szabi|szabadsag|szb)\b/.test(text)) {
    result.kind = /\b(fel|half)\b/.test(text) ? 'half_leave' : 'leave'; result.code = 'SZ'; return result;
  }
  if (/^(fel nap sz|fel sz|half leave|1\/2 szb|½ ?szb?)$/.test(text)) { result.kind = 'half_leave'; result.code = 'SZ'; return result; }
  if (/^(fix|fix szabadnap|fixed off)$/.test(text)) { result.kind = 'fixed_day_off'; return result; }
  if (/^(x|off|szabadnap|day off|szn)$/.test(text)) { result.kind = 'day_off'; return result; }
  if (/^(day or night|off or day|night or day|day\/night)$/.test(text)) {
    result.kind = 'other'; result.confident = false; keepNote(); return result;
  }

  const clock = readClockRange(text);
  result.extraMinutes = readExtraMinutes(text);
  result.hotelId = fill === 'mika' ? HOTEL_KEYS.mika : fill === 'otto' ? HOTEL_KEYS.otto : fill === 'memo' ? HOTEL_KEYS.memo : locationFromText(text);
  if (clock) { result.start = clock.start; result.end = clock.end; }

  if (/^(ho|home office)\b/.test(text) || /\bhome office\b/.test(text)) {
    result.kind = 'home_office'; result.code = 'HO';
  } else if (/\b(training|trening|minosites)\b/.test(text)) {
    result.kind = 'training'; result.code = 'TR';
  } else if (/^pn\b/.test(text)) {
    result.kind = 'extra_day'; result.code = 'PN';
  } else if (/\b(ejsz|ejszaka|night)\b/.test(text) || (clock && clock.end < clock.start && clock.start >= '18:00')) {
    result.kind = 'night';
    if (!clock) { result.start = '20:00'; result.end = '08:00'; }
  }

  if (!result.code && result.kind === 'work') {
    for (const [re, code, fraction] of DUTY_CODES) {
      if (re.test(text)) { result.code = code || null; if (fraction) result.dayFraction = fraction; break; }
    }
  }

  const understood = !!clock || !!result.code || result.kind !== 'work' || !!result.hotelId || !text;
  if (!understood) {
    if (fill) { keepNote(); result.confident = true; return result; } // coloured as a working day
    result.kind = 'other'; result.confident = false; keepNote(); return result;
  }
  // Keep remarks that carry information beyond the code ("609 fürdő", "!!!").
  if (raw && /[a-z]{4,}/.test(text.replace(/\b(ejsz|ejszaka|night|mika|mitico|otto|ottofiori|memo|memories|gozsdu|levante|reci|karbi|plusz|minusz|perc|ora|home|office|morning|afternoon|kitchen|public|area)\b/g, ''))) keepNote();
  return result;
}

const LOCATION_TOKEN: Record<string, string> = {
  [HOTEL_KEYS.mika]: 'mika', [HOTEL_KEYS.otto]: 'otto', [HOTEL_KEYS.memo]: 'memo', [HOTEL_KEYS.gozsdu]: 'gozsdu',
};

/**
 * Text that reads back to the same entry (used when copying cells out).
 * Pass `location` only when the person works away from their base hotel.
 */
export function cellText(
  entry: Pick<ParsedCell, 'kind' | 'code' | 'start' | 'end' | 'extraMinutes'> & { note?: string | null },
  location?: string | null,
): string {
  const times = entry.start && entry.end ? `${entry.start.slice(0, 5)}-${entry.end.slice(0, 5)}` : '';
  const extra = entry.extraMinutes ? `${entry.extraMinutes > 0 ? '+' : 'minusz '}${formatExtra(Math.abs(entry.extraMinutes))}` : '';
  const where = location ? LOCATION_TOKEN[location] ?? '' : '';
  const join = (...parts: string[]) => parts.filter(Boolean).join(' ');
  switch (entry.kind) {
    case 'leave': return 'SZB';
    case 'half_leave': return join('fél SZB', times);
    case 'sick': return 'B';
    case 'unpaid_leave': return 'FNSZ';
    case 'absent': return 'igazolatlan';
    case 'fixed_day_off': return 'FIX';
    case 'day_off': return 'X';
    case 'other': return entry.note ?? '';
    case 'night': return join('éjsz', times || '20:00-08:00', where, extra);
    case 'home_office': return join('HO', times, extra);
    case 'training': return join('TR', times, where, extra);
    case 'extra_day': return join('PN', times, where, extra);
    default: return join(entry.code ?? '', times, where, extra) || 'munka';
  }
}

function formatExtra(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} óra`;
  if (minutes < 60) return `${minutes}p`;
  return `${String(Math.round(minutes / 6) / 10).replace('.', ',')} óra`;
}

/** Clock duration in minutes, overnight aware; null when not a valid range. */
export function clockMinutes(start?: string | null, end?: string | null): number | null {
  const toMin = (v?: string | null) => {
    const m = v?.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]), mm = Number(m[2]);
    return h > 23 || mm > 59 ? null : h * 60 + mm;
  };
  const a = toMin(start), b = toMin(end);
  if (a === null || b === null || a === b) return null;
  return (b - a + 1440) % 1440;
}

/** Same calculation as the database trigger (worked minutes for one day). */
export function workedMinutes(entry: { kind: WorkforceKind; start?: string | null; end?: string | null; dayFraction?: number | null; extraMinutes?: number | null }, dailyHours = 8): number {
  const extra = entry.extraMinutes ?? 0;
  if (WORKING_KINDS.has(entry.kind)) {
    const clock = clockMinutes(entry.start, entry.end);
    const base = clock ?? Math.round(dailyHours * 60 * (entry.dayFraction ?? 1));
    return Math.max(0, base + extra);
  }
  if (entry.kind === 'half_leave') return Math.max(0, Math.round(dailyHours * 30) + extra);
  return 0;
}

/** A shift counts as a night shift when it is marked as one or runs past midnight from the evening. */
export function isNightShift(entry: { kind: WorkforceKind; start?: string | null; end?: string | null }): boolean {
  if (entry.kind === 'night') return true;
  if (!WORKING_KINDS.has(entry.kind) || !entry.start || !entry.end) return false;
  return entry.start.slice(0, 5) >= '18:00' && entry.end.slice(0, 5) < entry.start.slice(0, 5);
}
