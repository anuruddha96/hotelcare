// Mira's work-schedule planner. Deterministic: the language model chooses the
// period and the team, this module decides who works when and does the hour
// arithmetic. Nothing is written here; a plan becomes draft schedule entries
// only after the manager approves it on the plan card.
//
// Rules, in order of priority:
//   1. Existing entries are never changed (leave, sick days, fixed days off,
//      shifts already planned). Only empty days are filled, today or later.
//   2. Coverage: on every day each role gets at least what that team usually
//      has on that weekday (last weeks of the schedule), split into day and
//      night shifts. Room attendants get more when the bookings on the books
//      need it (checkouts × 45 min + stayovers × 15 min per 7.5-hour shift,
//      the same standards as auto-assign).
//   3. Hours: full-time and part-time staff are brought towards their monthly
//      norm (working days × daily hours, paid leave counts as worked), most
//      behind first, on the days where their team is thinnest.
//   4. Rest: no more than six working days in a row, and no day shift the day
//      after a night shift.
//
// Pure TypeScript (no Deno APIs) so vitest covers it.

import { isNonWorkingDay } from "./workforce/hungarianCalendar.ts";

export type PlannerKind =
  | "work" | "night" | "training" | "home_office" | "extra_day" | "leave" | "half_leave" | "sick"
  | "unpaid_leave" | "absent" | "day_off" | "fixed_day_off" | "other";

export type PlannerStaff = {
  id: string;
  name: string;
  jobRole: string | null;
  department: string | null;
  hotelId: string | null;
  employmentType: string | null;
  dailyHours: number;
  startDate: string | null;
  endDate: string | null;
};

export type PlannerEntry = {
  staffId: string;
  date: string;
  kind: PlannerKind;
  code: string | null;
  startTime: string | null;
  endTime: string | null;
  dayFraction: number;
  hotelId: string | null;
  status?: string | null;
  workedMinutes?: number | null;
};

export type ShiftTemplate = {
  kind: "work" | "night";
  code: string | null;
  startTime: string | null;
  endTime: string | null;
  dayFraction: number;
  minutes: number;
  shift: "day" | "night";
  /** Where it came from: the person's own history, their role, or a default. */
  source: "own" | "role" | "default";
};

export type DayDemand = { checkouts: number; stayovers: number };

export type PlannerInput = {
  hotelId: string;
  from: string;
  to: string;
  today: string;
  staff: PlannerStaff[];
  /**
   * Entries already in the schedule (any status), covering the whole months the
   * period touches plus the week before `from`, so month totals and rest rules
   * see everything.
   */
  entries: PlannerEntry[];
  /** Entries of the last weeks (published or draft) for templates and usual coverage. */
  history: PlannerEntry[];
  /** Bookings on the books per date, for room-attendant demand. */
  demand?: Record<string, DayDemand>;
  /** Extra people per role and date the manager asked for (e.g. {"Room attendant": 1}). */
  extraPerRole?: Record<string, number>;
  maxConsecutiveDays?: number;
};

export type PlannedCell = {
  staffId: string;
  date: string;
  kind: "work" | "night";
  code: string | null;
  startTime: string | null;
  endTime: string | null;
  dayFraction: number;
  minutes: number;
  reason: "coverage" | "hours";
};

export type PlannedStaffRow = {
  staffId: string;
  name: string;
  jobRole: string;
  employmentType: string | null;
  dailyHours: number;
  template: ShiftTemplate;
  /** Monthly norm for the months the period touches; null for hourly / external staff. */
  targetMinutes: number | null;
  /** Worked + paid absence already in the schedule for those months. */
  existingMinutes: number;
  proposedMinutes: number;
  proposedShifts: number;
  /** After the plan: + over the norm, − under it; null without a norm. */
  balanceAfterMinutes: number | null;
  warnings: string[];
};

export type PlannedDay = {
  date: string;
  weekday: string;
  holiday: boolean;
  demand: DayDemand | null;
  /** Per role and shift ("Room attendant · day"): required / before / after. */
  coverage: Array<{ bucket: string; role: string; shift: "day" | "night"; required: number; before: number; after: number }>;
};

export type SchedulePlan = {
  version: 1;
  kind: "schedule_plan";
  hotelId: string;
  from: string;
  to: string;
  cells: PlannedCell[];
  staff: PlannedStaffRow[];
  days: PlannedDay[];
  totals: {
    staff: number;
    shiftsAdded: number;
    minutesAdded: number;
    understaffedDays: number;
    staffUnderNorm: number;
    staffOverNorm: number;
  };
  assumptions: string[];
  warnings: string[];
};

/** Same time standards as auto-assign (roomAssignmentAlgorithmCore.ts). */
export const CHECKOUT_MINUTES = 45;
export const STAYOVER_MINUTES = 15;
export const ATTENDANT_WORK_MINUTES = 450;
export const MAX_PERIOD_DAYS = 31;

const WORKING: ReadonlySet<PlannerKind> = new Set(["work", "night", "training", "home_office", "extra_day"]);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NO_NORM = new Set(["hourly", "external"]);

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= 400; d = addDays(d, 1)) out.push(d);
  return out;
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function monthDates(date: string): string[] {
  const [y, m] = date.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
}

function timeMinutes(value: string | null): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function shiftLength(startTime: string | null, endTime: string | null): number | null {
  const start = timeMinutes(startTime);
  const end = timeMinutes(endTime);
  if (start === null || end === null || start === end) return null;
  return (end - start + 1440) % 1440;
}

function isNight(kind: PlannerKind, startTime: string | null): boolean {
  if (kind === "night") return true;
  const start = timeMinutes(startTime);
  return start !== null && start >= 18 * 60;
}

/** Minutes an entry counts towards the month (worked, or paid absence). */
export function entryMinutes(entry: PlannerEntry, dailyHours: number): number {
  if (typeof entry.workedMinutes === "number" && WORKING.has(entry.kind)) return entry.workedMinutes;
  if (WORKING.has(entry.kind)) {
    return shiftLength(entry.startTime, entry.endTime) ?? Math.round(dailyHours * 60 * (entry.dayFraction || 1));
  }
  if (entry.kind === "half_leave") return Math.round(dailyHours * 60);
  if (entry.kind === "leave" || entry.kind === "sick") return Math.round(dailyHours * 60);
  return 0;
}

function roleOf(staff: PlannerStaff): string {
  return staff.jobRole?.trim() || staff.department?.trim() || "Staff";
}

function isRoomAttendant(role: string): boolean {
  return /room attendant|szobaasszony|housekeeper|takarit/i.test(role);
}

function templateKey(e: PlannerEntry): string {
  return [e.kind, e.code ?? "", e.startTime ?? "", e.endTime ?? "", e.dayFraction].join("|");
}

function toTemplate(e: PlannerEntry, dailyHours: number, source: ShiftTemplate["source"]): ShiftTemplate {
  const night = isNight(e.kind, e.startTime);
  return {
    kind: e.kind === "night" ? "night" : "work",
    code: e.code,
    startTime: e.startTime,
    endTime: e.endTime,
    dayFraction: e.dayFraction || 1,
    minutes: shiftLength(e.startTime, e.endTime) ?? Math.round(dailyHours * 60 * (e.dayFraction || 1)),
    shift: night ? "night" : "day",
    source,
  };
}

function mostCommon(entries: PlannerEntry[]): PlannerEntry | null {
  const counts = new Map<string, { entry: PlannerEntry; n: number }>();
  for (const e of entries) {
    if (e.kind !== "work" && e.kind !== "night") continue;
    const key = templateKey(e);
    const hit = counts.get(key);
    if (hit) hit.n += 1;
    else counts.set(key, { entry: e, n: 1 });
  }
  let best: { entry: PlannerEntry; n: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.entry ?? null;
}

/** Stable order between equally good candidates, without favouring a name. */
function stableTieBreak(id: string, date: string): number {
  let h = 2166136261;
  for (const ch of `${id}|${date}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function buildSchedulePlan(input: PlannerInput): SchedulePlan {
  const maxConsecutive = Math.max(3, Math.min(input.maxConsecutiveDays ?? 6, 10));
  const from = input.from < input.today ? input.today : input.from;
  const period = datesBetween(from, input.to).slice(0, MAX_PERIOD_DAYS);
  const assumptions: string[] = [];
  const warnings: string[] = [];

  const staff = input.staff.filter((s) =>
    (!s.startDate || s.startDate <= input.to) && (!s.endDate || s.endDate >= from));

  // Everything already in the schedule, keyed by person and day.
  const cell = new Map<string, PlannerEntry | PlannedCell>();
  for (const e of input.entries) cell.set(`${e.staffId}|${e.date}`, e);

  // Templates: own most common shift, else the role's, else a full day.
  const byStaffHistory = new Map<string, PlannerEntry[]>();
  for (const e of input.history) {
    const list = byStaffHistory.get(e.staffId) ?? [];
    list.push(e);
    byStaffHistory.set(e.staffId, list);
  }
  const roleHistory = new Map<string, PlannerEntry[]>();
  for (const s of staff) {
    const list = roleHistory.get(roleOf(s)) ?? [];
    list.push(...(byStaffHistory.get(s.id) ?? []));
    roleHistory.set(roleOf(s), list);
  }

  // Night workers often alternate day and night shifts (reception 08–20 / 20–08):
  // keep both of their usual shifts so either can be offered.
  const templates = new Map<string, ShiftTemplate[]>();
  for (const s of staff) {
    const own = (byStaffHistory.get(s.id) ?? []).filter((e) => e.kind === "work" || e.kind === "night");
    const options: ShiftTemplate[] = [];
    const dayOwn = mostCommon(own.filter((e) => !isNight(e.kind, e.startTime)));
    const nightOwn = mostCommon(own.filter((e) => isNight(e.kind, e.startTime)));
    if (dayOwn) options.push(toTemplate(dayOwn, s.dailyHours, "own"));
    if (nightOwn) options.push(toTemplate(nightOwn, s.dailyHours, "own"));
    if (!options.length) {
      const roleCommon = mostCommon(roleHistory.get(roleOf(s)) ?? []);
      options.push(roleCommon
        ? toTemplate(roleCommon, s.dailyHours, "role")
        : { kind: "work", code: null, startTime: null, endTime: null, dayFraction: 1, minutes: Math.round(s.dailyHours * 60), shift: "day", source: "default" });
    }
    // The shift they work most often comes first.
    options.sort((a, b) => {
      const countOf = (t: ShiftTemplate) => own.filter((e) => isNight(e.kind, e.startTime) === (t.shift === "night")).length;
      return countOf(b) - countOf(a);
    });
    templates.set(s.id, options);
  }

  // Monthly norm and what is already in the schedule for those months.
  const months = [...new Set(period.map((d) => d.slice(0, 7)))];
  const target = new Map<string, number | null>();
  const existing = new Map<string, number>();
  for (const s of staff) {
    if (NO_NORM.has(String(s.employmentType ?? "")) || !(s.dailyHours > 0)) {
      target.set(s.id, null);
    } else {
      let minutes = 0;
      for (const month of months) {
        const days = monthDates(`${month}-01`).filter((d) =>
          (!s.startDate || d >= s.startDate) && (!s.endDate || d <= s.endDate));
        minutes += days.filter((d) => !isNonWorkingDay(d)).length * s.dailyHours * 60;
      }
      target.set(s.id, Math.round(minutes));
    }
    let counted = 0;
    for (const e of input.entries) {
      if (e.staffId !== s.id || !months.includes(e.date.slice(0, 7))) continue;
      counted += entryMinutes(e, s.dailyHours);
    }
    existing.set(s.id, counted);
  }
  const proposedMinutes = new Map<string, number>(staff.map((s) => [s.id, 0]));
  const proposedShifts = new Map<string, number>(staff.map((s) => [s.id, 0]));
  const remaining = (s: PlannerStaff) => {
    const t = target.get(s.id);
    return t === null || t === undefined ? null : t - (existing.get(s.id) ?? 0) - (proposedMinutes.get(s.id) ?? 0);
  };

  // Usual coverage per role, shift and weekday from the history.
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const usual = new Map<string, number>();
  {
    const perDate = new Map<string, number>();
    const weeksSeen = new Map<string, Set<string>>();
    for (const e of input.history) {
      const s = staffById.get(e.staffId);
      if (!s || !WORKING.has(e.kind) || (e.hotelId && e.hotelId !== input.hotelId)) continue;
      const shift = isNight(e.kind, e.startTime) ? "night" : "day";
      const key = `${roleOf(s)}|${shift}|${e.date}`;
      perDate.set(key, (perDate.get(key) ?? 0) + 1);
    }
    for (const [key, n] of perDate) {
      const [role, shift, date] = key.split("|");
      const wkKey = `${role}|${shift}|${weekdayOf(date)}`;
      const seen = weeksSeen.get(wkKey) ?? new Set<string>();
      seen.add(`${date}:${n}`);
      weeksSeen.set(wkKey, seen);
    }
    for (const [wkKey, seen] of weeksSeen) {
      const counts = [...seen].map((v) => Number(v.split(":")[1])).sort((a, b) => a - b);
      usual.set(wkKey, counts[Math.floor(counts.length / 2)] ?? 0);
    }
  }
  if (!input.history.length) assumptions.push("There is no schedule history for this team yet, so coverage follows the bookings only.");

  const roles = [...new Set(staff.map(roleOf))].sort();
  const shiftsOfRole = (role: string): Array<"day" | "night"> => {
    const set = new Set<"day" | "night">();
    for (const s of staff) if (roleOf(s) === role) for (const t of templates.get(s.id) ?? []) set.add(t.shift);
    return [...set].sort();
  };

  const isWorking = (staffId: string, date: string): "day" | "night" | null => {
    const c = cell.get(`${staffId}|${date}`);
    if (!c) return null;
    if ("reason" in c) return isNight(c.kind, c.startTime) ? "night" : "day";
    if (!WORKING.has(c.kind)) return null;
    return isNight(c.kind, c.startTime) ? "night" : "day";
  };

  const countScheduled = (role: string, shift: "day" | "night", date: string) =>
    staff.filter((s) => roleOf(s) === role && isWorking(s.id, date) === shift).length;

  const required = (role: string, shift: "day" | "night", date: string): number => {
    let need = usual.get(`${role}|${shift}|${weekdayOf(date)}`) ?? 0;
    const demand = input.demand?.[date];
    if (demand && shift === "day" && isRoomAttendant(role)) {
      const minutes = demand.checkouts * CHECKOUT_MINUTES + demand.stayovers * STAYOVER_MINUTES;
      need = Math.max(need, Math.ceil(minutes / ATTENDANT_WORK_MINUTES));
    }
    if (shift === "day") need += Math.max(0, Math.round(input.extraPerRole?.[role] ?? 0));
    const available = staff.filter((s) => roleOf(s) === role && (templates.get(s.id) ?? []).some((t) => t.shift === shift)).length;
    return Math.min(need, available);
  };

  const consecutiveBefore = (staffId: string, date: string): number => {
    let n = 0;
    for (let d = addDays(date, -1); n < 14; d = addDays(d, -1)) {
      if (!isWorking(staffId, d)) break;
      n += 1;
    }
    return n;
  };
  const consecutiveAfter = (staffId: string, date: string): number => {
    let n = 0;
    for (let d = addDays(date, 1); n < 14; d = addDays(d, 1)) {
      if (!isWorking(staffId, d)) break;
      n += 1;
    }
    return n;
  };

  const canWork = (s: PlannerStaff, template: ShiftTemplate, date: string): boolean => {
    if (date < input.today) return false;
    if (s.startDate && date < s.startDate) return false;
    if (s.endDate && date > s.endDate) return false;
    if (cell.has(`${s.id}|${date}`)) return false;
    if (consecutiveBefore(s.id, date) + 1 + consecutiveAfter(s.id, date) > maxConsecutive) return false;
    if (template.shift === "day" && isWorking(s.id, addDays(date, -1)) === "night") return false;
    if (isWorking(s.id, addDays(date, 1)) === "day" && template.shift === "night") return false;
    return true;
  };

  const place = (s: PlannerStaff, template: ShiftTemplate, date: string, reason: PlannedCell["reason"]) => {
    const planned: PlannedCell = {
      staffId: s.id,
      date,
      kind: template.kind,
      code: template.code,
      startTime: template.startTime,
      endTime: template.endTime,
      dayFraction: template.dayFraction,
      minutes: template.minutes,
      reason,
    };
    cell.set(`${s.id}|${date}`, planned);
    proposedMinutes.set(s.id, (proposedMinutes.get(s.id) ?? 0) + template.minutes);
    proposedShifts.set(s.id, (proposedShifts.get(s.id) ?? 0) + 1);
  };

  const recentShifts = (staffId: string, date: string) => {
    let n = 0;
    for (let i = 1; i <= 6; i++) if (isWorking(staffId, addDays(date, -i))) n += 1;
    return n;
  };

  // Pass 1: coverage.
  const before = new Map<string, number>();
  for (const date of period) {
    for (const role of roles) {
      for (const shift of shiftsOfRole(role)) {
        const have = countScheduled(role, shift, date);
        before.set(`${role}|${shift}|${date}`, have);
        let need = required(role, shift, date) - have;
        if (need <= 0) continue;
        const candidates = staff
          .filter((s) => roleOf(s) === role)
          .map((s) => ({ s, t: (templates.get(s.id) ?? []).find((t) => t.shift === shift) }))
          .filter((c): c is { s: PlannerStaff; t: ShiftTemplate } => !!c.t && canWork(c.s, c.t, date))
          // People without a norm (hourly) are used only when nobody on a norm can work.
          .filter((c) => { const r = remaining(c.s); return r === null || r >= c.t.minutes / 2; })
          .sort((a, b) => {
            const ra = remaining(a.s), rb = remaining(b.s);
            if ((ra === null) !== (rb === null)) return ra === null ? 1 : -1;
            if (ra !== null && rb !== null && rb !== ra) return rb - ra;
            const recent = recentShifts(a.s.id, date) - recentShifts(b.s.id, date);
            if (recent) return recent;
            return stableTieBreak(a.s.id, date) - stableTieBreak(b.s.id, date);
          });
        for (const c of candidates) {
          if (need <= 0) break;
          place(c.s, c.t, date, "coverage");
          need -= 1;
        }
      }
    }
  }

  // Pass 2: bring people towards their norm on the thinnest days of their team.
  for (const s of [...staff].sort((a, b) => (remaining(b) ?? -Infinity) - (remaining(a) ?? -Infinity))) {
    const options = templates.get(s.id) ?? [];
    const main = options[0];
    if (!main) continue;
    let guard = 0;
    while (guard++ < 40) {
      const r = remaining(s);
      if (r === null || r < main.minutes * 0.75) break;
      const role = roleOf(s);
      const slots = period
        .flatMap((date) => options.map((t) => ({ date, t })))
        .filter(({ date, t }) => canWork(s, t, date))
        .map(({ date, t }) => ({ date, t, slack: countScheduled(role, t.shift, date) - required(role, t.shift, date) }))
        .sort((a, b) => a.slack - b.slack || (a.t === main ? -1 : 0) - (b.t === main ? -1 : 0) || a.date.localeCompare(b.date));
      const best = slots[0];
      if (!best) break;
      place(s, best.t, best.date, "hours");
    }
  }

  // Results.
  const cells = [...cell.values()].filter((c): c is PlannedCell => "reason" in c)
    .sort((a, b) => a.date.localeCompare(b.date) || a.staffId.localeCompare(b.staffId));

  const days: PlannedDay[] = period.map((date) => {
    const coverage = roles.flatMap((role) => shiftsOfRole(role).map((shift) => ({
      bucket: `${role} · ${shift}`,
      role,
      shift,
      required: required(role, shift, date),
      before: before.get(`${role}|${shift}|${date}`) ?? countScheduled(role, shift, date),
      after: countScheduled(role, shift, date),
    })));
    return {
      date,
      weekday: WEEKDAYS[weekdayOf(date)],
      holiday: isNonWorkingDay(date) && weekdayOf(date) !== 0 && weekdayOf(date) !== 6,
      demand: input.demand?.[date] ?? null,
      coverage,
    };
  });

  const rows: PlannedStaffRow[] = staff.map((s) => {
    const t = target.get(s.id) ?? null;
    const after = t === null ? null : (existing.get(s.id) ?? 0) + (proposedMinutes.get(s.id) ?? 0) - t;
    const template = (templates.get(s.id) ?? [])[0];
    const rowWarnings: string[] = [];
    if (template?.source === "default") rowWarnings.push("No previous shifts: a full day is assumed.");
    if (after !== null && after < -8 * 60) rowWarnings.push(`${Math.round(-after / 60)} h under the monthly norm (no free day left within the rules).`);
    if (after !== null && after > 8 * 60) rowWarnings.push(`${Math.round(after / 60)} h over the monthly norm already.`);
    return {
      staffId: s.id,
      name: s.name,
      jobRole: roleOf(s),
      employmentType: s.employmentType,
      dailyHours: s.dailyHours,
      template,
      targetMinutes: t,
      existingMinutes: existing.get(s.id) ?? 0,
      proposedMinutes: proposedMinutes.get(s.id) ?? 0,
      proposedShifts: proposedShifts.get(s.id) ?? 0,
      balanceAfterMinutes: after,
      warnings: rowWarnings,
    };
  }).sort((a, b) => a.jobRole.localeCompare(b.jobRole) || a.name.localeCompare(b.name));

  const understaffedDays = days.filter((d) => d.coverage.some((c) => c.after < c.required)).length;
  if (understaffedDays) warnings.push(`${understaffedDays} day(s) stay below the usual staffing: not enough people are free within the rest rules.`);
  if (period.length < datesBetween(input.from, input.to).length) warnings.push("Past days were left out; only today and later can be planned.");
  if (input.demand) assumptions.push(`Room attendants: at least the usual number, more when bookings need it (checkout ${CHECKOUT_MINUTES} min, stayover ${STAYOVER_MINUTES} min, ${ATTENDANT_WORK_MINUTES / 60} h per shift). Bookings that arrive later add work.`);
  assumptions.push(`At most ${maxConsecutive} working days in a row; no day shift after a night shift. Existing entries (leave, sick days, days off, planned shifts) are kept.`);

  return {
    version: 1,
    kind: "schedule_plan",
    hotelId: input.hotelId,
    from,
    to: input.to,
    cells,
    staff: rows,
    days,
    totals: {
      staff: rows.length,
      shiftsAdded: cells.length,
      minutesAdded: cells.reduce((sum, c) => sum + c.minutes, 0),
      understaffedDays,
      staffUnderNorm: rows.filter((r) => r.balanceAfterMinutes !== null && r.balanceAfterMinutes < -8 * 60).length,
      staffOverNorm: rows.filter((r) => r.balanceAfterMinutes !== null && r.balanceAfterMinutes > 8 * 60).length,
    },
    assumptions,
    warnings,
  };
}

/** The sentence the manager agrees to; stored word for word with the decision. */
export function scheduleConsentText(params: {
  hotelName: string;
  department: string;
  from: string;
  to: string;
  shifts: number;
  minutes: number;
  people: number;
  publish: boolean;
}): string {
  const hours = Math.round(params.minutes / 6) / 10;
  return `I approve adding ${params.shifts} shift${params.shifts === 1 ? "" : "s"} (${hours} h) for ${params.people} ${params.people === 1 ? "person" : "people"} to the ${params.hotelName} work schedule (${params.department}, ${params.from} – ${params.to}) as ${params.publish ? "PUBLISHED shifts that staff can see" : "a draft that staff do not see yet"}. Existing entries stay as they are.`.slice(0, 1000);
}
