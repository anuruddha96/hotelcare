// Mira and the work schedule: read hours and coverage, and prepare a schedule
// plan the manager approves on a card.
//
// Every read of the schedule goes through the signed-in person's own session,
// so row-level security decides what Mira can see: the whole organization for
// HR / top management, the selected hotel for managers, every hotel to read
// but only their own to plan for housekeeping managers, and only their own
// hotel for supervisors. Mira never writes the
// schedule here; an approved plan is saved by assistant-apply-action, again
// with the person's session.

import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonSchema, tool } from "npm:ai@7";
import type { AssistantHotel } from "./assistantHotels.ts";
import type { AccessCapabilities } from "./accessPolicy.ts";
import { createActionRequest, type ActionRequestAttachment } from "./assistantPlanRequests.ts";
import {
  buildSchedulePlan,
  datesBetween,
  entryMinutes,
  MAX_PERIOD_DAYS,
  type DayDemand,
  type PlannerEntry,
  type PlannerKind,
  type PlannerStaff,
} from "./schedulePlanner.ts";
import { isNonWorkingDay } from "./workforce/hungarianCalendar.ts";

type Ctx = {
  service: any;
  profile: { id: string; role: string; organization_slug: string | null; assigned_hotel: string | null };
  access: AccessCapabilities;
  hotels: AssistantHotel[];
  resolve: (requested: string | null | undefined) => string[];
  today: () => string;
  pageHotelId: string | null;
  threadId: string | null;
  supabaseUrl: string;
  authHeader: string;
  attachments: Array<ActionRequestAttachment | Record<string, unknown>>;
};

type Scope = { level: "org" | "property"; hotelId: string; organizationSlug: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_COLUMNS = "staff_id,work_date,kind,code,start_time,end_time,day_fraction,hotel_id,status,worked_minutes";

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function userClient(ctx: Ctx) {
  return createClient(ctx.supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: ctx.authHeader } },
    auth: { persistSession: false },
  });
}

async function fetchAll<T>(build: (from: number, to: number) => any, pageSize = 1000, max = 20_000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const { data, error } = await build(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

/** Which hotel's schedule this person may read and plan (decided by the database). */
async function resolveScope(ctx: Ctx, db: any, requested: string | null, mode: "read" | "plan" = "plan"): Promise<Scope | { error: string }> {
  const { data, error } = await db.rpc("workforce_access");
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return { error: "The work schedule is not available for your account." };
  if (row.access_level === "property") {
    // Housekeeping managers may read (not plan) another hotel when they name it.
    if (mode === "read" && requested) {
      const ids = ctx.resolve(requested);
      if (ids.length === 1 && ids[0] !== String(row.hotel_id ?? "")) {
        const { data: viewAll } = await db.rpc("workforce_can_view_all");
        if (viewAll === true) return { level: "property", hotelId: ids[0], organizationSlug: String(row.organization_slug) };
        return { error: "You can see the work schedule of your own hotel only." };
      }
    }
    if (!row.hotel_id) return { error: "Select your hotel first." };
    return { level: "property", hotelId: String(row.hotel_id), organizationSlug: String(row.organization_slug) };
  }
  if (row.access_level !== "org") return { error: "Planning the work schedule is not part of your role." };
  const ids = ctx.resolve(requested ?? ctx.pageHotelId ?? ctx.profile.assigned_hotel);
  if (ids.length !== 1) {
    return { error: `Name one hotel: ${ctx.hotels.map((h) => h.hotel_name).join(", ")}.` };
  }
  return { level: "org", hotelId: ids[0], organizationSlug: String(row.organization_slug) };
}

type StaffRow = {
  id: string; full_name: string; nickname: string | null; department_id: string | null; job_role_id: string | null;
  hotel_id: string | null; employment_type: string | null; daily_hours: number | null; start_date: string | null;
  end_date: string | null; is_active: boolean;
};

async function loadTeam(db: any, scope: Scope, department: string | null) {
  const [departments, roles, staff] = await Promise.all([
    db.from("workforce_departments").select("id,name"),
    db.from("workforce_job_roles").select("id,name,department_id"),
    fetchAll<StaffRow>((a, b) => db.from("workforce_staff")
      .select("id,full_name,nickname,department_id,job_role_id,hotel_id,employment_type,daily_hours,start_date,end_date,is_active")
      .eq("is_active", true).eq("hotel_id", scope.hotelId).order("id").range(a, b)),
  ]);
  if (departments.error) throw new Error(departments.error.message);
  if (roles.error) throw new Error(roles.error.message);
  const deptName = new Map<string, string>((departments.data ?? []).map((d: any) => [String(d.id), String(d.name)]));
  const roleName = new Map<string, string>((roles.data ?? []).map((r: any) => [String(r.id), String(r.name)]));
  const wanted = department?.trim().toLowerCase() || null;
  const members: PlannerStaff[] = staff
    .map((s) => ({
      id: s.id,
      name: s.nickname?.trim() || s.full_name,
      jobRole: s.job_role_id ? roleName.get(s.job_role_id) ?? null : null,
      department: s.department_id ? deptName.get(s.department_id) ?? null : null,
      hotelId: s.hotel_id,
      employmentType: s.employment_type,
      dailyHours: Number(s.daily_hours ?? 8) || 8,
      startDate: s.start_date,
      endDate: s.end_date,
    }))
    .filter((s) => !wanted || (s.department ?? "").toLowerCase().includes(wanted) || (s.jobRole ?? "").toLowerCase().includes(wanted));
  const knownDepartments = [...new Set(staff.map((s) => (s.department_id ? deptName.get(s.department_id) : null)).filter(Boolean))] as string[];
  return { members, knownDepartments };
}

function toEntry(row: any): PlannerEntry {
  return {
    staffId: String(row.staff_id),
    date: String(row.work_date),
    kind: String(row.kind) as PlannerKind,
    code: row.code ?? null,
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    dayFraction: Number(row.day_fraction ?? 1) || 1,
    hotelId: row.hotel_id ?? null,
    status: row.status ?? null,
    workedMinutes: typeof row.worked_minutes === "number" ? row.worked_minutes : null,
  };
}

async function loadEntries(db: any, staffIds: string[], from: string, to: string): Promise<PlannerEntry[]> {
  if (!staffIds.length) return [];
  const out: PlannerEntry[] = [];
  for (let i = 0; i < staffIds.length; i += 80) {
    const chunk = staffIds.slice(i, i + 80);
    const rows = await fetchAll<any>((a, b) => db.from("workforce_entries").select(ENTRY_COLUMNS)
      .in("staff_id", chunk).gte("work_date", from).lte("work_date", to).order("work_date").range(a, b));
    out.push(...rows.map(toEntry));
  }
  return out;
}

/** Bookings on the books per day: checkouts and stayovers (service read, hotel already authorized). */
async function loadDemand(service: any, organizationSlug: string, hotelId: string, from: string, to: string): Promise<Record<string, DayDemand>> {
  const { data, error } = await service
    .from("reservations")
    .select("check_in_date,check_out_date,status")
    .eq("organization_slug", organizationSlug)
    .eq("hotel_id", hotelId)
    .not("status", "in", "(cancelled,no_show)")
    .lte("check_in_date", to)
    .gte("check_out_date", from)
    .limit(10_000);
  if (error) throw new Error(error.message);
  const demand: Record<string, DayDemand> = {};
  for (const date of datesBetween(from, to)) demand[date] = { checkouts: 0, stayovers: 0 };
  for (const r of data ?? []) {
    const inDate = String(r.check_in_date), outDate = String(r.check_out_date);
    if (demand[outDate]) demand[outDate].checkouts += 1;
    for (let d = addDays(inDate, 1); d < outDate && d <= to; d = addDays(d, 1)) if (demand[d]) demand[d].stayovers += 1;
  }
  return demand;
}

/** Short cell text, like the Work schedule grid (SZB, B, FIX, 8–20, É 20–8). */
function entryLabel(e: PlannerEntry): string {
  const times = e.startTime && e.endTime ? `${Number(e.startTime.slice(0, 2))}–${Number(e.endTime.slice(0, 2))}` : "";
  switch (e.kind) {
    case "leave": return "SZB";
    case "half_leave": return "½SZB";
    case "sick": return "B";
    case "unpaid_leave": return "FNSZ";
    case "absent": return "IG";
    case "fixed_day_off": return "FIX";
    case "day_off": return "X";
    case "night": return `É${times ? ` ${times}` : ""}`;
    case "other": return "?";
    default: return e.code && e.code !== "SZ" ? e.code : times || e.code || "✓";
  }
}

function period(start: string | null, end: string | null, today: string): { from: string; to: string } | { error: string } {
  const from = start && ISO_DATE.test(start) ? start : today;
  const to = end && ISO_DATE.test(end) ? end : monthEnd(from);
  if (to < from) return { error: "The end date is before the start date." };
  if (datesBetween(from, to).length > MAX_PERIOD_DAYS) return { error: `Plan at most ${MAX_PERIOD_DAYS} days at a time (for example one month).` };
  return { from, to };
}

export function scheduleToolsAvailable(access: AccessCapabilities, organizationSlug: string | null): boolean {
  // The work schedule module runs for RD Hotels (SLNT keeps its own roster).
  return access.scheduleBuilder && organizationSlug === "rdhotels";
}

export function buildScheduleTools(ctx: Ctx): Record<string, any> {
  const tools: Record<string, any> = {};
  const hoursText = (minutes: number) => Math.round(minutes / 6) / 10;

  tools.get_work_schedule = tool({
    description:
      "Read the work schedule of ONE hotel team for a period: per person the planned hours against the monthly norm (working days × daily hours, paid leave counts as worked), shifts, leave and sick days, and per day how many people of each role work. Use it for questions about hours, overtime, who works when, or gaps in the schedule.",
    inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null; department: string | null }>({
      type: "object",
      properties: {
        hotelId: { type: ["string", "null"], description: "Hotel id, or null for the user's own hotel" },
        startDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null for the start of this month" },
        endDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null for the end of that month" },
        department: { type: ["string", "null"], description: "Department or job role, e.g. Housekeeping, Reception, Room attendant; null for everyone" },
      },
      required: ["hotelId", "startDate", "endDate", "department"],
      additionalProperties: false,
    }),
    execute: async ({ hotelId, startDate, endDate, department }) => {
      const db = userClient(ctx);
      const scope = await resolveScope(ctx, db, hotelId, "read");
      if ("error" in scope) return { ok: false, error: scope.error };
      const today = ctx.today();
      const window = period(startDate ?? monthStart(today), endDate, "1900-01-01");
      if ("error" in window) return { ok: false, error: window.error };
      try {
        const { members, knownDepartments } = await loadTeam(db, scope, department);
        if (!members.length) return { ok: false, error: `No active staff found${department ? ` for "${department}"` : ""}. Departments here: ${knownDepartments.join(", ") || "none"}.` };
        const entries = await loadEntries(db, members.map((m) => m.id), monthStart(window.from), monthEnd(window.to));
        const months = [...new Set(datesBetween(window.from, window.to).map((d) => d.slice(0, 7)))];
        const people = members.map((m) => {
          const mine = entries.filter((e) => e.staffId === m.id && months.includes(e.date.slice(0, 7)));
          const worked = mine.reduce((s, e) => s + entryMinutes(e, m.dailyHours), 0);
          const norm = ["hourly", "external"].includes(String(m.employmentType ?? ""))
            ? null
            : months.reduce((sum, month) => {
              const days = datesBetween(`${month}-01`, monthEnd(`${month}-01`))
                .filter((d) => (!m.startDate || d >= m.startDate) && (!m.endDate || d <= m.endDate) && !isNonWorkingDay(d));
              return sum + days.length * m.dailyHours * 60;
            }, 0);
          const inPeriod = mine.filter((e) => e.date >= window.from && e.date <= window.to);
          return {
            name: m.name,
            role: m.jobRole ?? m.department ?? "Staff",
            employment: m.employmentType,
            planned_hours: hoursText(worked),
            norm_hours: norm === null ? null : hoursText(norm),
            balance_hours: norm === null ? null : hoursText(worked - norm),
            shifts_in_period: inPeriod.filter((e) => ["work", "night", "training", "home_office", "extra_day"].includes(e.kind)).length,
            leave_days: inPeriod.filter((e) => e.kind === "leave").length + inPeriod.filter((e) => e.kind === "half_leave").length / 2,
            sick_days: inPeriod.filter((e) => e.kind === "sick").length,
            draft_entries: inPeriod.filter((e) => e.status === "draft").length,
            empty_days: datesBetween(window.from, window.to).filter((d) => !inPeriod.some((e) => e.date === d)).length,
          };
        });
        const daily = datesBetween(window.from, window.to).map((date) => {
          const working = entries.filter((e) => e.date === date && ["work", "night", "training", "home_office", "extra_day"].includes(e.kind));
          const byRole: Record<string, number> = {};
          for (const e of working) {
            const m = members.find((x) => x.id === e.staffId);
            const key = m?.jobRole ?? m?.department ?? "Staff";
            byRole[key] = (byRole[key] ?? 0) + 1;
          }
          return { date, working: working.length, by_role: byRole };
        });
        return {
          ok: true,
          hotel_id: scope.hotelId,
          hotel_name: ctx.hotels.find((h) => h.hotel_id === scope.hotelId)?.hotel_name ?? scope.hotelId,
          from: window.from,
          to: window.to,
          note: "Norm = working days of the month × daily hours; paid leave and sick days count as worked. Hourly and external staff have no norm.",
          people,
          days: daily,
        };
      } catch (error) {
        return { ok: false, error: `The work schedule could not be read: ${(error as Error).message}` };
      }
    },
  });

  tools.get_schedule_changes = tool({
    description:
      "Changes to the work schedule of ONE hotel team for a period: (1) published days that changed and the employee has NOT confirmed yet (who, which day, before -> after, reason, short notice under 4 days), (2) changes a manager made after publishing that are NOT published yet (the employee still sees the old shift), and (3) how many draft days wait for Publish. Use it for \"who has not confirmed\", \"what changed\", \"what is still unpublished\".",
    inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null; department: string | null }>({
      type: "object",
      properties: {
        hotelId: { type: ["string", "null"], description: "Hotel id, or null for the user's own hotel" },
        startDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null for today" },
        endDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null for the end of that month" },
        department: { type: ["string", "null"], description: "Department or job role; null for everyone" },
      },
      required: ["hotelId", "startDate", "endDate", "department"],
      additionalProperties: false,
    }),
    execute: async ({ hotelId, startDate, endDate, department }) => {
      const db = userClient(ctx);
      const scope = await resolveScope(ctx, db, hotelId, "read");
      if ("error" in scope) return { ok: false, error: scope.error };
      const window = period(startDate, endDate, ctx.today());
      if ("error" in window) return { ok: false, error: window.error };
      try {
        const { members } = await loadTeam(db, scope, department);
        const nameOf = new Map(members.map((m) => [m.id, m.name]));
        const ids = members.map((m) => m.id);
        const shift = (row: any) => (row ? entryLabel(toEntry({ ...row, staff_id: "", work_date: "" })) : "day off");
        const unconfirmed: Array<Record<string, unknown>> = [];
        const unpublished: Array<Record<string, unknown>> = [];
        let drafts = 0;
        for (let i = 0; i < ids.length; i += 80) {
          const chunk = ids.slice(i, i + 80);
          const [notices, pending] = await Promise.all([
            db.from("workforce_change_notices").select("staff_id,work_date,before,after,short_notice,reason,changed_at")
              .in("staff_id", chunk).is("acknowledged_at", null).gte("work_date", window.from).lte("work_date", window.to).order("work_date").limit(500),
            db.from("workforce_entries").select(`${ENTRY_COLUMNS},published_version`)
              .in("staff_id", chunk).eq("status", "draft").gte("work_date", window.from).lte("work_date", window.to).order("work_date").limit(1000),
          ]);
          if (notices.error) throw new Error(notices.error.message);
          if (pending.error) throw new Error(pending.error.message);
          for (const n of notices.data ?? []) {
            unconfirmed.push({ name: nameOf.get(String(n.staff_id)), date: n.work_date, before: shift(n.before), after: shift(n.after), reason: n.reason, short_notice: n.short_notice, changed_at: n.changed_at });
          }
          for (const e of pending.data ?? []) {
            drafts += 1;
            if (e.published_version) unpublished.push({ name: nameOf.get(String(e.staff_id)), date: e.work_date, employee_still_sees: shift(e.published_version), planned: entryLabel(toEntry(e)) });
          }
        }
        return {
          ok: true,
          hotel_id: scope.hotelId,
          hotel_name: ctx.hotels.find((h) => h.hotel_id === scope.hotelId)?.hotel_name ?? scope.hotelId,
          from: window.from,
          to: window.to,
          draft_days_waiting_for_publish: drafts,
          changes_not_published_yet: unpublished,
          published_changes_not_confirmed_by_employee: unconfirmed,
          note: "Employees see only published days. A change to a published day reaches them when the manager presses Publish; they then confirm it in the app. Changes less than 4 days ahead need the employee's agreement (Mt. 97. § (5)).",
        };
      } catch (error) {
        return { ok: false, error: `The schedule changes could not be read: ${(error as Error).message}` };
      }
    },
  });

  tools.plan_work_schedule = tool({
    description:
      "Prepare a work-schedule plan for ONE hotel team and a period (at most 31 days): fills only EMPTY days, keeps leave, sick days, fixed days off and shifts already planned, covers the usual staffing per weekday (more room attendants when bookings need it), brings full-time staff towards their monthly hour norm, and keeps rest rules (max 6 days in a row, no day shift after a night). Returns a plan card with the grid, hours and coverage; the manager approves it there and it is saved as a DRAFT. Use it when someone asks to make, build, fill or complete the schedule.",
    inputSchema: jsonSchema<{ hotelId: string | null; startDate: string | null; endDate: string | null; department: string | null; extraPerRole: Record<string, number> | null }>({
      type: "object",
      properties: {
        hotelId: { type: ["string", "null"], description: "Hotel id, or null for the user's own hotel" },
        startDate: { type: ["string", "null"], description: "First day YYYY-MM-DD, or null for today" },
        endDate: { type: ["string", "null"], description: "Last day YYYY-MM-DD, or null for the end of that month" },
        department: { type: ["string", "null"], description: "Department or job role to plan, e.g. Housekeeping or Reception; null for the whole hotel team" },
        extraPerRole: {
          type: ["object", "null"],
          description: "Only when the user asks for more people than usual: extra people per job role on day shifts, e.g. {\"Room attendant\": 1}",
          additionalProperties: { type: "number" },
        },
      },
      required: ["hotelId", "startDate", "endDate", "department", "extraPerRole"],
      additionalProperties: false,
    }),
    execute: async ({ hotelId, startDate, endDate, department, extraPerRole }) => {
      const db = userClient(ctx);
      const scope = await resolveScope(ctx, db, hotelId);
      if ("error" in scope) return { ok: false, error: scope.error };
      const today = ctx.today();
      const window = period(startDate, endDate, today);
      if ("error" in window) return { ok: false, error: window.error };
      if (window.to < today) return { ok: false, error: "Only today and future days can be planned." };
      try {
        const { members, knownDepartments } = await loadTeam(db, scope, department);
        if (!members.length) return { ok: false, error: `No active staff found${department ? ` for "${department}"` : ""}. Departments here: ${knownDepartments.join(", ") || "none"}.` };
        const ids = members.map((m) => m.id);
        const entryFrom = monthStart(window.from) < addDays(window.from, -7) ? monthStart(window.from) : addDays(window.from, -7);
        const [entries, history, demand] = await Promise.all([
          loadEntries(db, ids, entryFrom, monthEnd(window.to)),
          loadEntries(db, ids, addDays(window.from, -56), addDays(window.from, -1)),
          loadDemand(ctx.service, scope.organizationSlug, scope.hotelId, window.from, window.to).catch(() => undefined),
        ]);
        const extras: Record<string, number> = {};
        for (const [role, n] of Object.entries(extraPerRole ?? {})) {
          const value = Math.round(Number(n));
          if (Number.isFinite(value) && value > 0 && value <= 10) extras[role] = value;
        }
        const plan = buildSchedulePlan({
          hotelId: scope.hotelId,
          from: window.from,
          to: window.to,
          today,
          staff: members,
          entries,
          // Last weeks' shifts at this hotel, published or draft.
          history: history.filter((e) => e.date < window.from),
          demand,
          extraPerRole: extras,
        });
        const hotelName = ctx.hotels.find((h) => h.hotel_id === scope.hotelId)?.hotel_name ?? scope.hotelId;
        const departmentLabel = department?.trim() || "whole team";
        // What is already in the schedule for those days, so the card shows the
        // new shifts next to leave, days off and shifts planned before.
        const existing: Record<string, Record<string, string>> = {};
        for (const e of entries) {
          if (e.date < plan.from || e.date > plan.to) continue;
          (existing[e.staffId] ??= {})[e.date] = entryLabel(e);
        }
        const cardPlan = {
          ...plan,
          hotelName,
          department: departmentLabel,
          staffNames: Object.fromEntries(members.map((m) => [m.id, m.name])),
          existing,
        };
        const summary = `${plan.totals.shiftsAdded} shifts (${hoursText(plan.totals.minutesAdded)} h) for ${plan.totals.staff} people; ${plan.totals.understaffedDays} day(s) below usual staffing.`;
        let approval: { request_id: string; expires_at: string } | null = null;
        if (plan.cells.length > 0) {
          const title = `Schedule plan · ${hotelName} · ${departmentLabel} · ${plan.from} → ${plan.to}`;
          const created = await createActionRequest(ctx.service, {
            organizationSlug: scope.organizationSlug,
            hotelId: scope.hotelId,
            threadId: ctx.threadId,
            requestedBy: ctx.profile.id,
            kind: "schedule_plan",
            title,
            summary,
            plan: cardPlan,
          });
          if (created.ok) {
            approval = { request_id: created.id, expires_at: created.expiresAt };
            ctx.attachments.push({ kind: "action_request", requestId: created.id, requestKind: "schedule_plan", title });
          } else {
            return { ok: false, error: `The plan could not be saved for approval: ${created.error}` };
          }
        }
        return {
          ok: true,
          approval,
          hotel_name: hotelName,
          department: departmentLabel,
          from: plan.from,
          to: plan.to,
          totals: { ...plan.totals, hours_added: hoursText(plan.totals.minutesAdded) },
          people: plan.staff.map((r) => ({
            name: r.name,
            role: r.jobRole,
            usual_shift: r.template.startTime && r.template.endTime ? `${r.template.startTime.slice(0, 5)}–${r.template.endTime.slice(0, 5)}` : r.template.code ?? "full day",
            norm_hours: r.targetMinutes === null ? null : hoursText(r.targetMinutes),
            hours_after_plan: hoursText(r.existingMinutes + r.proposedMinutes),
            balance_after_hours: r.balanceAfterMinutes === null ? null : hoursText(r.balanceAfterMinutes),
            shifts_added: r.proposedShifts,
          })),
          understaffed_days: plan.days.filter((d) => d.coverage.some((c) => c.after < c.required)).map((d) => d.date),
          assumptions: plan.assumptions,
          warnings: plan.warnings,
          how_to_apply: approval
            ? "The plan card is shown under your answer with the grid, hours and coverage. The manager approves it there; it is saved as a DRAFT (nothing is published to staff). Keep your answer short: shifts and hours added, days still short-staffed, anyone far from their norm."
            : "Nothing to add: every day is already planned or nobody is free within the rules.",
        };
      } catch (error) {
        return { ok: false, error: `The plan could not be prepared: ${(error as Error).message}` };
      }
    },
  });

  return tools;
}

export function schedulePrompt(): string {
  return [
    "",
    "WORK SCHEDULE",
    "- Questions about hours, overtime, norm, leave, who works when: call get_work_schedule and answer with the numbers (hours planned vs norm, balance).",
    "- \"Make / build / fill / complete the schedule\": call plan_work_schedule for the hotel, team and period (default: rest of this month; for \"next month\" use the whole next month). It fills only empty days and never changes leave, sick days or planned shifts. The plan card shows the grid, hours and coverage; the manager approves it there and it is saved as a draft. Never say the schedule was changed or published.",
    "- \"Who has not confirmed\", \"what changed\", \"what is not published yet\": call get_schedule_changes. Name the people and days; for changes under 4 days say the employee has to agree.",
    "- Housekeeping managers can read every hotel's schedule but plan only their own; supervisors read and plan only their own hotel. If they ask to plan another hotel, say so.",
    "- Employees see only their own published days. Never tell an employee about a colleague's shifts or about unpublished drafts.",
  ].join("\n");
}
