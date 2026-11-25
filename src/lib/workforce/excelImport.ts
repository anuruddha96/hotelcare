/**
 * Turns the RD Hotels WORK_SCHEDULE workbook into workforce records.
 *
 * Layout of the workbook: one tab per month ("November 2026", "Október 2026"),
 * row 1 = department label per column ("GOZSDU HK", "MIKA reci"), row 2 =
 * employee name, column A = day of month. Rows after the last day can repeat
 * the first days of the next month; those are skipped (the next tab owns them).
 * A "Megjegyzés" row holds monthly remarks, a "Szabadság (összes/…)" row the
 * leave balance ("21/6" = 21 days in total, 6 still available).
 *
 * Runs in the browser: the file never leaves the device until the reviewed
 * result is sent to the database.
 */
import { parseCell, WORKING_KINDS, type WorkforceKind } from './cellParser';

export interface WorkbookCell { text: string | null; fill: string | null }
export interface WorkbookColumn { col: number; label: string | null; name: string; inferredLabel?: boolean }
export interface WorkbookMonth {
  sheet: string; year: number; month: number;
  columns: WorkbookColumn[];
  /** day of month -> column -> cell */
  days: Map<number, Map<number, WorkbookCell>>;
  notes: Map<number, string>;
  leave: Map<number, string>;
}

const MONTHS: Record<string, number> = {
  januar: 1, january: 1, februar: 2, february: 2, marcius: 3, march: 3, aprilis: 4, april: 4,
  majus: 5, may: 5, junius: 6, june: 6, julius: 7, july: 7, augusztus: 8, august: 8,
  szeptember: 9, september: 9, oktober: 10, october: 10, november: 11, december: 12,
};

export const plainText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function monthOfSheet(title: string): { year: number; month: number } | null {
  const t = plainText(title);
  const year = Number(t.match(/\b20\d{2}\b/)?.[0]);
  const month = Object.entries(MONTHS).find(([name]) => t.includes(name))?.[1];
  return year && month ? { year, month } : null;
}

type SheetJs = {
  utils: { decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } }; encode_cell: (c: { r: number; c: number }) => string };
};
type SheetCell = { v?: unknown; w?: string; t?: string; s?: { patternType?: string; fgColor?: { rgb?: string } } };

/** Reads every month tab of a SheetJS workbook (read with cellStyles: true). */
export function readScheduleWorkbook(XLSX: SheetJs, workbook: { SheetNames: string[]; Sheets: Record<string, Record<string, unknown>> }): WorkbookMonth[] {
  const months: WorkbookMonth[] = [];
  for (const sheet of workbook.SheetNames) {
    const period = monthOfSheet(sheet);
    const ws = workbook.Sheets[sheet];
    if (!period || !ws?.['!ref']) continue;
    const range = XLSX.utils.decode_range(String(ws['!ref']));
    const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as SheetCell | undefined;
    const textOf = (x?: SheetCell): string | null => {
      if (!x || x.t === 'z' || x.v === undefined || x.v === null) return null;
      // Dates: use the displayed text ("08-17"), which is what the person typed.
      const raw = x.t === 'd' || x.t === 'n' ? (x.w ?? String(x.v)) : String(x.v);
      const value = raw.replace(/\r/g, '').trim();
      return value || null;
    };
    const fillOf = (x?: SheetCell): string | null => {
      const s = x?.s;
      if (!s || !s.patternType || s.patternType === 'none') return null;
      return s.fgColor?.rgb ?? null;
    };

    const columns: WorkbookColumn[] = [];
    for (let c = 2; c <= range.e.c; c++) {
      const name = textOf(cell(1, c));
      if (name) columns.push({ col: c, label: textOf(cell(0, c)), name });
    }
    // A column without a department label belongs to the group it sits in.
    columns.forEach((column, i) => {
      if (column.label) return;
      const left = columns.slice(0, i).reverse().find((x) => x.label)?.label ?? null;
      const right = columns.slice(i + 1).find((x) => x.label)?.label ?? null;
      column.label = left ?? right;
      column.inferredLabel = true;
    });
    const days = new Map<number, Map<number, WorkbookCell>>();
    const notes = new Map<number, string>();
    const leave = new Map<number, string>();
    let last = 0;
    let lastRow = 2;
    for (let r = 2; r <= Math.min(range.e.r, 70); r++) {
      const a = cell(r, 0);
      const day = typeof a?.v === 'number' ? a.v : Number(NaN);
      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        if (day <= last) break;
        last = day; lastRow = r;
        const row = new Map<number, WorkbookCell>();
        for (const { col } of columns) {
          const x = cell(r, col);
          const text = textOf(x), fill = fillOf(x);
          if (text || (fill && !/FFFFFF$/i.test(fill))) row.set(col, { text, fill });
        }
        days.set(day, row);
      }
    }
    for (let r = lastRow + 1; r <= Math.min(range.e.r, 90); r++) {
      const label = textOf(cell(r, 0));
      if (!label) continue;
      const key = plainText(label);
      const target = key.startsWith('megjegyzes') ? notes : key.startsWith('szabadsag (osszes') ? leave : null;
      if (!target) continue;
      for (const { col } of columns) {
        const value = textOf(cell(r, col));
        if (value) target.set(col, value);
      }
    }
    months.push({ sheet, ...period, columns, days, notes, leave });
  }
  return months.sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
}

// ---------------------------------------------------------------------------
// Names, departments and roles

export function cleanEmployeeName(raw: string) {
  let s = raw.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ');
  const nickname = s.match(/\/\s*([^/]+?)\s*\//)?.[1]?.trim() ?? null;
  const flags = { sixHours: /6\s*órás/i.test(s), partTime: /part\s*-?\s*time/i.test(s), external: /beugrós/i.test(s), casual: /\balkalmi(s)?\b/i.test(s) };
  s = s.replace(/\/[^/]*\//g, ' ')
    .replace(/\b6\s*órás\b/gi, ' ')
    .replace(/part\s*-?\s*time.*$/i, ' ')
    .replace(/\bbeugrós\b/gi, ' ')
    .replace(/\balkalmi(s)?\b/gi, ' ')
    .replace(/,\s*(SV|K\d?|HK)\b.*$/i, ' ')
    .replace(/\b(SZ|SV)\s*\d*\s*$/i, ' ')
    .replace(/\s+(HK|SV\d?|K\d?)\s*$/i, ' ')
    .replace(/\s+\d[\d\s-]*(days?|nap|ó|óra|ora|h)?\.?\s*$/i, ' ')
    .replace(/\s+\d+\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { name: s, nickname, ...flags };
}

/** Order-insensitive identity: "Gani Soufiane" = "Soufiane Gani". */
export function nameKey(name: string): string {
  return [...new Set(plainText(name).split(/[^a-z]+/).filter((t) => t.length >= 2 && t !== 'jr'))].sort().join(' ');
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** One typo allowed in longer words ("Baysal" / "Bayasal"). */
export const sameNameToken = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1);

export const DEFAULT_DEPARTMENTS: Array<{ name: string; color: string }> = [
  { name: 'Administration', color: '#64748b' }, { name: 'Reception', color: '#0ea5e9' },
  { name: 'Housekeeping', color: '#8b5cf6' }, { name: 'Maintenance', color: '#f59e0b' },
  { name: 'Kitchen & Breakfast', color: '#ef4444' }, { name: 'Restaurant & Bar', color: '#10b981' },
  { name: 'Other', color: '#94a3b8' },
];

const HOTEL_PREFIX: Array<[RegExp, string]> = [
  [/^gozsdu/, 'gozsdu-court'], [/^mika/, 'mika-downtown'], [/^memo/, 'memories-budapest'], [/^otto/, 'ottofiori'],
];

/** Department, job role and base hotel from a workbook column label. */
export function classifyColumnLabel(label: string | null): { department: string; role: string; hotel: string | null } | null {
  if (!label) return null;
  const l = plainText(label).replace(/\s+/g, ' ').trim();
  const hotel = HOTEL_PREFIX.find(([re]) => re.test(l))?.[1] ?? null;
  if (l.includes('penzugy')) return { department: 'Administration', role: 'Finance', hotel: null };
  if (l === 'hr') return { department: 'Administration', role: 'HR', hotel: null };
  if (l.includes('marketing')) return { department: 'Administration', role: 'Marketing', hotel: null };
  if (l.includes('sales')) return { department: 'Administration', role: 'Sales', hotel: null };
  if (l.includes('trainee')) return { department: 'Administration', role: 'Trainee', hotel: null };
  if (l === 'otto') return { department: 'Other', role: 'Ottofiori staff', hotel: 'ottofiori' };
  if (l === 'memo/otto') return { department: 'Reception', role: 'Front office manager', hotel: 'memories-budapest' };
  if (l.includes('reci vezeto')) return { department: 'Reception', role: 'Reception lead', hotel };
  if (l.includes('reci')) return { department: 'Reception', role: 'Receptionist', hotel };
  if (l.includes('hk manager') || l.includes('hk vezeto')) return { department: 'Housekeeping', role: 'Housekeeping manager', hotel };
  if (/\bsv\b/.test(l)) return { department: 'Housekeeping', role: 'Supervisor', hotel };
  if (/\bhk\b/.test(l) || l.includes('taki')) return { department: 'Housekeeping', role: 'Room attendant', hotel };
  if (l.includes('karbi')) return { department: 'Maintenance', role: 'Maintenance technician', hotel };
  if (l.includes('konyha')) return { department: 'Kitchen & Breakfast', role: 'Kitchen staff', hotel };
  if (l.includes('reggeli')) return { department: 'Kitchen & Breakfast', role: l.startsWith('mitico') ? 'Breakfast – Mitico' : 'Breakfast – Levante', hotel: null };
  if (l.startsWith('mitico')) {
    if (l.includes('f&b')) return { department: 'Restaurant & Bar', role: 'F&B manager', hotel: null };
    if (l.includes('manager')) return { department: 'Restaurant & Bar', role: 'Restaurant manager – Mitico', hotel: null };
    if (l.includes('hostess')) return { department: 'Restaurant & Bar', role: 'Hostess – Mitico', hotel: null };
    if (l.includes('hangtechnika')) return { department: 'Restaurant & Bar', role: 'Sound technician – Mitico', hotel: null };
    return { department: 'Restaurant & Bar', role: 'Service – Mitico', hotel: null };
  }
  if (l.startsWith('levante')) {
    if (l.includes('dishwasher')) return { department: 'Restaurant & Bar', role: 'Dishwasher – Levante', hotel: null };
    return { department: 'Restaurant & Bar', role: 'Service – Levante', hotel: null };
  }
  return null;
}

export const DEFAULT_SHIFT_CODES = [
  ['SZ', 'Room cleaning (szoba)', 'work', null, null, 1], ['K', 'Kitchen (konyha)', 'work', null, null, 1],
  ['K/2', 'Half kitchen shift', 'work', null, null, 0.5], ['K1', 'Kitchen – first cook', 'work', null, null, 1],
  ['HK', 'Housekeeping', 'work', null, null, 1], ['SV', 'Supervisor', 'work', null, null, 1],
  ['L', 'Laundry (L)', 'work', null, null, 1], ['PA', 'Public area 07–15', 'work', '07:00', '15:00', 1],
  ['08-17', 'Day 08–17', 'work', '08:00', '17:00', 1], ['08-20', 'Day 08–20', 'work', '08:00', '20:00', 1],
  ['11-20', 'Late 11–20', 'work', '11:00', '20:00', 1], ['É', 'Night 20–08 (éjszaka)', 'night', '20:00', '08:00', 1],
  ['PN', 'Extra day (PN)', 'extra_day', null, null, 1], ['HO', 'Home office', 'home_office', null, null, 1],
  ['TR', 'Training / qualification', 'training', null, null, 1],
  ['SZB', 'Leave (szabadság)', 'leave', null, null, 1], ['½SZB', 'Half-day leave', 'half_leave', null, null, 1],
  ['B', 'Sick (betegség)', 'sick', null, null, 1], ['FNSZ', 'Unpaid leave', 'unpaid_leave', null, null, 1],
  ['IG', 'Unexcused absence (igazolatlan)', 'absent', null, null, 1],
  ['X', 'Day off (szabadnap)', 'day_off', null, null, 1], ['FIX', 'Fixed day off', 'fixed_day_off', null, null, 1],
].map(([code, label, kind, start_time, end_time, day_fraction], sort_order) => ({ code, label, kind, start_time, end_time, day_fraction, sort_order })) as Array<{
  code: string; label: string; kind: WorkforceKind; start_time: string | null; end_time: string | null; day_fraction: number; sort_order: number;
}>;

// ---------------------------------------------------------------------------
// Planning

export interface ExistingDirectory {
  departments: Array<{ id: string; name: string }>;
  jobRoles: Array<{ id: string; department_id: string; name: string }>;
  staff: Array<{ id: string; full_name: string; nickname: string | null; profile_id: string | null; is_active: boolean }>;
  profiles: Array<{ id: string; full_name: string | null; nickname?: string | null }>;
}

export interface ImportEntry {
  staff_id: string; work_date: string; kind: WorkforceKind; code: string | null; start_time: string | null; end_time: string | null;
  day_fraction: number; extra_minutes: number; hotel_id: string | null; raw_text: string | null; note: string | null; status: 'draft' | 'published';
}

export interface ImportPlan {
  months: Array<{ sheet: string; key: string; entries: number; staff: number }>;
  departments: Array<{ id: string; name: string; color: string; sort_order: number }>;
  jobRoles: Array<{ id: string; department_id: string; name: string; sort_order: number }>;
  newStaff: Array<Record<string, unknown> & { id: string; full_name: string; is_active: boolean; profile_id: string | null }>;
  matchedStaff: number;
  entries: ImportEntry[];
  notes: Array<{ staff_id: string; month: string; note: string }>;
  byKind: Record<string, number>;
  unreadable: Array<{ text: string; count: number }>;
  links: Array<{ staff: string; account: string }>;
  ambiguousLinks: string[];
}

const ROLE_WORD = /^(konyha|reci|recepci[oó]|hk|sv|karbi|taki|reggeli|felszolg[aá]l[oó])$/i;
const GENERIC_ACCOUNT = /^(hmb|hmb reception|levante|mika brunch|supervisor|otto reci|laura - control|maryjoy-\d+|reception|test.*)$/i;
const tokenSet = (s: string) => new Set(plainText(s).split(/[^a-z]+/).filter((t) => t.length >= 2));

export function planWorkforceImport(
  months: WorkbookMonth[],
  existing: ExistingDirectory,
  options: { today: string; monthKeys?: Set<string>; newId: () => string },
): ImportPlan {
  const selected = months.filter((m) => !options.monthKeys || options.monthKeys.has(monthKey(m)));
  const newId = options.newId;

  // 1. People across months.
  type Person = {
    key: string; name: string; nickname: string | null; labels: Array<{ ym: number; label: string | null; col: number }>;
    sixHours: boolean; partTime: boolean; external: boolean; casual: boolean; firstYm: number; lastYm: number; aliases: Set<string>;
  };
  const people = new Map<string, Person>();
  const owner = new Map<string, Person>(); // sheet|col
  for (const month of selected) {
    const ym = month.year * 100 + month.month;
    for (const column of month.columns) {
      const cleaned = cleanEmployeeName(column.name);
      // A column titled only with a job word ("konyha") is an unnamed slot of that job.
      const slot = ROLE_WORD.test(cleaned.name);
      const label = slot ? `${(column.label ?? '').split(/[\s/-]+/)[0]} ${cleaned.name}`.trim() : column.label;
      const placeholder = !cleaned.name || /^beugr/i.test(cleaned.name) || slot;
      const key = placeholder ? `beugros|${plainText(label ?? '')}` : nameKey(cleaned.name);
      if (!key || key === 'beugros|' && !cleaned.external) continue;
      let person = people.get(key);
      if (!person) {
        const placeholderName = slot ? `Unnamed slot (${label})` : `Beugrós (${label ?? 'extra'})`;
        person = { key, name: placeholder ? placeholderName : cleaned.name, nickname: cleaned.nickname, labels: [],
          sixHours: false, partTime: false, external: placeholder, casual: false, firstYm: ym, lastYm: ym, aliases: new Set([key]) };
        people.set(key, person);
      }
      if (ym > person.lastYm && !placeholder) person.name = cleaned.name;
      if (!placeholder) person.aliases.add(nameKey(cleaned.name));
      person.labels.push({ ym, label, col: column.col });
      person.nickname ??= cleaned.nickname;
      person.sixHours ||= cleaned.sixHours; person.partTime ||= cleaned.partTime; person.external ||= cleaned.external; person.casual ||= cleaned.casual;
      person.firstYm = Math.min(person.firstYm, ym); person.lastYm = Math.max(person.lastYm, ym);
      owner.set(`${month.sheet}|${column.col}`, person);
    }
  }
  // Fold spelling variants and shortened names into one person.
  for (const shorter of [...people.values()]) {
    if (shorter.key.startsWith('beugros|')) continue;
    const a = shorter.key.split(' ');
    if (a.length < 2) continue;
    const target = [...people.values()].find((other) => {
      if (other === shorter || other.key.startsWith('beugros|')) return false;
      const b = other.key.split(' ');
      if (b.length > a.length) return a.every((t) => b.includes(t));
      return b.length === a.length && other.lastYm >= shorter.lastYm && a.every((t) => b.some((u) => sameNameToken(t, u)));
    });
    if (!target) continue;
    target.labels.push(...shorter.labels);
    target.firstYm = Math.min(target.firstYm, shorter.firstYm); target.lastYm = Math.max(target.lastYm, shorter.lastYm);
    target.sixHours ||= shorter.sixHours; target.partTime ||= shorter.partTime; target.casual ||= shorter.casual; target.nickname ??= shorter.nickname;
    for (const alias of shorter.aliases) target.aliases.add(alias);
    for (const [k, p] of owner) if (p === shorter) owner.set(k, target);
    people.delete(shorter.key);
  }

  // 2. Departments and roles (existing ones are reused).
  const departments: ImportPlan['departments'] = [];
  const deptByName = new Map(existing.departments.map((d) => [plainText(d.name), d.id]));
  const deptId = (name: string) => {
    const k = plainText(name);
    if (!deptByName.has(k)) {
      const color = DEFAULT_DEPARTMENTS.find((d) => d.name === name)?.color ?? '#94a3b8';
      const id = newId();
      departments.push({ id, name, color, sort_order: DEFAULT_DEPARTMENTS.findIndex((d) => d.name === name) });
      deptByName.set(k, id);
    }
    return deptByName.get(k)!;
  };
  const jobRoles: ImportPlan['jobRoles'] = [];
  const roleByKey = new Map(existing.jobRoles.map((r) => [`${r.department_id}|${plainText(r.name)}`, r.id]));
  const roleId = (department: string, name: string) => {
    const d = deptId(department);
    const k = `${d}|${plainText(name)}`;
    if (!roleByKey.has(k)) { const id = newId(); jobRoles.push({ id, department_id: d, name, sort_order: roleByKey.size }); roleByKey.set(k, id); }
    return roleByKey.get(k)!;
  };

  // 3. Match with employees already in Hotel Care, otherwise create.
  const existingByKey = new Map(existing.staff.map((s) => [nameKey(s.full_name), s]));
  const latestYm = Math.max(0, ...selected.map((m) => m.year * 100 + m.month));
  const [ty, tm] = options.today.split('-').map(Number);
  const currentYm = ty * 100 + tm;
  const staffIdOf = new Map<Person, string>();
  const newStaff: ImportPlan['newStaff'] = [];
  let matchedStaff = 0;
  for (const person of people.values()) {
    const match = [person.key, nameKey(person.name), ...person.aliases].map((k) => existingByKey.get(k)).find(Boolean);
    if (match) { staffIdOf.set(person, match.id); matchedStaff++; continue; }
    const labels = [...person.labels].sort((x, y) => y.ym - x.ym);
    const cls = labels.map((l) => classifyColumnLabel(l.label)).find(Boolean) ?? { department: 'Other', role: 'Unassigned', hotel: null };
    const active = person.lastYm >= Math.min(currentYm, latestYm);
    const id = newId();
    staffIdOf.set(person, id);
    newStaff.push({
      id, full_name: person.name, nickname: person.nickname,
      department_id: deptId(cls.department), job_role_id: roleId(cls.department, cls.role), hotel_id: cls.hotel,
      employment_type: person.external ? 'external' : person.casual ? 'hourly' : person.partTime ? 'part_time' : 'full_time',
      daily_hours: person.sixHours ? 6 : 8,
      is_active: active,
      end_date: active ? null : new Date(Date.UTC(Math.floor(person.lastYm / 100), person.lastYm % 100, 0)).toISOString().slice(0, 10),
      sort_order: (labels[0].ym === latestYm ? 0 : 10000) + labels[0].col,
      source_label: [...new Set(labels.map((l) => l.label).filter(Boolean))].join(' · ') || null,
      notes: person.partTime ? 'Part-time: confirm daily hours.' : null,
      annual_leave_days: null, leave_note: null, profile_id: null,
    });
  }

  // 4. Days.
  const firstOfNextMonth = new Date(Date.UTC(ty, tm, 1)).toISOString().slice(0, 10);
  const entries = new Map<string, ImportEntry>();
  const unreadable = new Map<string, number>();
  const monthStats: ImportPlan['months'] = [];
  for (const month of selected) {
    let count = 0;
    const staffSeen = new Set<string>();
    for (const [day, row] of month.days) {
      const date = `${month.year}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      for (const [col, cell] of row) {
        const person = owner.get(`${month.sheet}|${col}`);
        if (!person) continue;
        const parsed = parseCell(cell.text, { fill: cell.fill });
        if (!parsed) continue;
        const staffId = staffIdOf.get(person)!;
        const entry: ImportEntry = {
          staff_id: staffId, work_date: date, kind: parsed.kind, code: parsed.code, start_time: parsed.start, end_time: parsed.end,
          day_fraction: parsed.dayFraction, extra_minutes: parsed.extraMinutes, hotel_id: parsed.hotelId,
          raw_text: cell.text, note: parsed.note, status: date < firstOfNextMonth ? 'published' : 'draft',
        };
        const key = `${staffId}|${date}`;
        const previous = entries.get(key);
        if (previous) {
          const rank = (k: WorkforceKind) => (WORKING_KINDS.has(k) ? 2 : k === 'other' ? 0 : 1);
          const keep = rank(entry.kind) > rank(previous.kind) ? entry : previous;
          const drop = keep === entry ? previous : entry;
          keep.note = [keep.note, drop.raw_text && `Also: ${drop.raw_text}`].filter(Boolean).join(' · ') || null;
          entries.set(key, keep);
        } else { entries.set(key, entry); count++; }
        staffSeen.add(staffId);
        if (parsed.kind === 'other' && cell.text) unreadable.set(cell.text, (unreadable.get(cell.text) ?? 0) + 1);
      }
    }
    monthStats.push({ sheet: month.sheet, key: monthKey(month), entries: count, staff: staffSeen.size });
  }

  // 5. Remarks and leave balances.
  const notes = new Map<string, { staff_id: string; month: string; note: string }>();
  const leaveBy = new Map<string, { ym: number; value: string }>();
  for (const month of selected) {
    const ym = month.year * 100 + month.month;
    const first = `${month.year}-${String(month.month).padStart(2, '0')}-01`;
    for (const [col, value] of month.notes) {
      const person = owner.get(`${month.sheet}|${col}`);
      if (!person) continue;
      const id = staffIdOf.get(person)!;
      const k = `${id}|${first}`;
      const prev = notes.get(k);
      notes.set(k, { staff_id: id, month: first, note: prev ? `${prev.note} · ${value}` : value });
    }
    for (const [col, value] of month.leave) {
      const person = owner.get(`${month.sheet}|${col}`);
      if (!person) continue;
      const id = staffIdOf.get(person)!;
      const prev = leaveBy.get(id);
      if (!prev || prev.ym < ym) leaveBy.set(id, { ym, value });
    }
  }
  const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const staff of newStaff) {
    const leave = leaveBy.get(staff.id);
    if (!leave) continue;
    const when = `${MONTH_NAMES[leave.ym % 100]} ${Math.floor(leave.ym / 100)}`;
    // "21/6"; Excel sometimes turned it into a date shown as "09-09".
    const m = leave.value.match(/^(\d{1,2})\s*[/-]\s*(\d{1,2})$/);
    if (m) {
      staff.annual_leave_days = Number(m[1]);
      staff.leave_note = `Excel (${when}): ${m[1]} days in total, ${m[2]} still available up to the end of the previous month`;
    } else staff.leave_note = `Excel (${when}): ${leave.value}`;
  }

  // 6. Link app accounts only when the match is unambiguous both ways.
  const taken = new Set(existing.staff.map((s) => s.profile_id).filter(Boolean));
  const candidates = new Map<string, Array<{ profile: ExistingDirectory['profiles'][number]; score: number }>>();
  const reverse = new Map<string, Array<{ staffId: string; score: number }>>();
  for (const profile of existing.profiles) {
    const name = (profile.full_name ?? '').trim();
    if (!name || GENERIC_ACCOUNT.test(name) || taken.has(profile.id)) continue;
    const pt = tokenSet(name);
    if (![...pt].some((t) => t.length >= 3)) continue;
    for (const staff of newStaff) {
      const st = new Set([...tokenSet(staff.full_name), ...tokenSet(String(staff.nickname ?? ''))]);
      if ([...pt].every((t) => [...st].some((u) => sameNameToken(t, u)))) {
        const score = pt.size + (staff.is_active ? 0.5 : 0);
        candidates.set(staff.id, [...(candidates.get(staff.id) ?? []), { profile, score }]);
        reverse.set(profile.id, [...(reverse.get(profile.id) ?? []), { staffId: staff.id, score }]);
      }
    }
  }
  const links: ImportPlan['links'] = [];
  const ambiguousLinks: string[] = [];
  for (const staff of newStaff) {
    const list = candidates.get(staff.id);
    if (!list) continue;
    const best = Math.max(...list.map((c) => c.score));
    const top = list.filter((c) => c.score === best);
    if (top.length !== 1) { ambiguousLinks.push(`${staff.full_name}: ${top.map((c) => c.profile.full_name).join(' / ')}`); continue; }
    const back = reverse.get(top[0].profile.id) ?? [];
    const rbest = Math.max(...back.map((r) => r.score));
    if (back.filter((r) => r.score === rbest).length !== 1) { ambiguousLinks.push(`${staff.full_name}: ${top[0].profile.full_name} (several employees)`); continue; }
    staff.profile_id = top[0].profile.id;
    links.push({ staff: staff.full_name, account: top[0].profile.full_name ?? '' });
  }

  const all = [...entries.values()];
  const byKind: Record<string, number> = {};
  for (const e of all) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  return {
    months: monthStats, departments, jobRoles, newStaff, matchedStaff, entries: all, notes: [...notes.values()], byKind,
    unreadable: [...unreadable].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
    links, ambiguousLinks,
  };
}

export const monthKey = (m: { year: number; month: number }) => `${m.year}-${String(m.month).padStart(2, '0')}`;
