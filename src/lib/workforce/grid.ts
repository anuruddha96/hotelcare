/**
 * Spreadsheet behaviour for the schedule grid: clipboard text in the format
 * Excel and Google Sheets use (tab separated, quoted cells for line breaks),
 * typing a cell, and turning entries back into the text people type.
 */
import { cellText, parseCell, type CustomShiftCode } from './cellParser';
import type { WorkforceEntry, WorkforceShiftCode, WorkforceStaff } from './model';

export function toTsv(rows: string[][]): string {
  const quote = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(quote).join('\t')).join('\n');
}

/** Parses clipboard text from Excel / Sheets (quoted cells may contain tabs and line breaks). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export const customCodesOf = (codes: readonly WorkforceShiftCode[]): CustomShiftCode[] =>
  codes.filter((c) => c.is_active).map((c) => ({
    code: c.code, kind: c.kind, start_time: c.start_time, end_time: c.end_time, day_fraction: c.day_fraction, hotel_id: c.hotel_id,
  }));

/**
 * What a typed or pasted text means for one employee on one day.
 * Returns null when the cell should be emptied.
 */
export function entryFromText(
  text: string,
  staff: Pick<WorkforceStaff, 'id' | 'hotel_id'>,
  date: string,
  codes: readonly CustomShiftCode[],
): WorkforceEntry | null {
  const parsed = parseCell(text, { customCodes: codes });
  if (!parsed) return null;
  return {
    staff_id: staff.id,
    work_date: date,
    kind: parsed.kind,
    code: parsed.code,
    start_time: parsed.start,
    end_time: parsed.end,
    day_fraction: parsed.dayFraction,
    extra_minutes: parsed.extraMinutes,
    hotel_id: parsed.hotelId ?? staff.hotel_id ?? null,
    raw_text: parsed.raw || null,
    note: parsed.note,
    status: 'draft',
  };
}

/** The text that reproduces an entry when typed or pasted again. */
export function textOfEntry(entry: WorkforceEntry | undefined, baseHotel: string | null): string {
  if (!entry) return '';
  const away = entry.hotel_id && entry.hotel_id !== baseHotel ? entry.hotel_id : null;
  return cellText({
    kind: entry.kind, code: entry.code, start: entry.start_time, end: entry.end_time,
    extraMinutes: entry.extra_minutes, note: entry.note ?? entry.raw_text,
  }, away);
}

export interface CellRange { r1: number; c1: number; r2: number; c2: number }
export const normalizeRange = (a: { r: number; c: number }, b: { r: number; c: number }): CellRange => ({
  r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c),
});
export const inRange = (range: CellRange | null, r: number, c: number) =>
  !!range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;

/**
 * Where pasted cells land. A single copied value fills the whole selection
 * (as in Excel); a block is pasted from the top-left of the selection, and
 * repeated to fill a selection that is an exact multiple of it.
 */
export function pasteTargets(block: string[][], selection: CellRange, maxRow: number, maxCol: number): Array<{ r: number; c: number; value: string }> {
  const h = block.length;
  const w = Math.max(...block.map((r) => r.length));
  const selH = selection.r2 - selection.r1 + 1;
  const selW = selection.c2 - selection.c1 + 1;
  const repeat = (h === 1 && w === 1) || (selH % h === 0 && selW % w === 0 && (selH > h || selW > w));
  const outH = repeat ? selH : h;
  const outW = repeat ? selW : w;
  const out: Array<{ r: number; c: number; value: string }> = [];
  for (let dr = 0; dr < outH; dr++) for (let dc = 0; dc < outW; dc++) {
    const r = selection.r1 + dr, c = selection.c1 + dc;
    if (r > maxRow || c > maxCol) continue;
    out.push({ r, c, value: block[dr % h]?.[dc % w] ?? '' });
  }
  return out;
}

/**
 * Excel fill handle: dragging the corner of a selection repeats the selected
 * block down, up, right or left (whichever way the pointer moved furthest).
 */
export function fillHandleTargets(range: CellRange, to: { r: number; c: number }): {
  targets: Array<{ r: number; c: number; from: { r: number; c: number } }>; extended: CellRange;
} {
  const h = range.r2 - range.r1 + 1, w = range.c2 - range.c1 + 1;
  const dr = to.r > range.r2 ? to.r - range.r2 : to.r < range.r1 ? to.r - range.r1 : 0;
  const dc = to.c > range.c2 ? to.c - range.c2 : to.c < range.c1 ? to.c - range.c1 : 0;
  const targets: Array<{ r: number; c: number; from: { r: number; c: number } }> = [];
  if (!dr && !dc) return { targets, extended: range };
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  if (Math.abs(dr) >= Math.abs(dc)) {
    const rows = dr > 0 ? [range.r2 + 1, range.r2 + dr] : [range.r1 + dr, range.r1 - 1];
    for (let r = rows[0]; r <= rows[1]; r++) for (let c = range.c1; c <= range.c2; c++)
      targets.push({ r, c, from: { r: range.r1 + mod(r - range.r1, h), c } });
    return { targets, extended: { ...range, r1: Math.min(range.r1, rows[0]), r2: Math.max(range.r2, rows[1]) } };
  }
  const cols = dc > 0 ? [range.c2 + 1, range.c2 + dc] : [range.c1 + dc, range.c1 - 1];
  for (let c = cols[0]; c <= cols[1]; c++) for (let r = range.r1; r <= range.r2; r++)
    targets.push({ r, c, from: { r, c: range.c1 + mod(c - range.c1, w) } });
  return { targets, extended: { ...range, c1: Math.min(range.c1, cols[0]), c2: Math.max(range.c2, cols[1]) } };
}
