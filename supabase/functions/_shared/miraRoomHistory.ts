// Who did what to a room, on which day. Mira used to see only today's
// assignment and only the cleaner's name, so for "who approved 038 on Monday"
// it named the manager who had ASSIGNED the room instead of the supervisor
// who APPROVED it. Every person now comes with the part they played.

import { ACCESS_ROLE_LABEL, effectiveAccessRole } from "./accessPolicy.ts";
import { addDays } from "./miraDates.ts";

type Service = any;

export const ASSIGNMENT_COLUMNS =
  "id,room_id,assignment_date,assignment_type,status,assigned_to,assigned_by,started_at,completed_at," +
  "supervisor_approved,supervisor_approved_by,supervisor_approved_at,supervisor_review_outcome," +
  "supervisor_reviewed_by,supervisor_reviewed_at,is_dnd,dnd_marked_by,dnd_marked_at,service_result," +
  "total_break_time_minutes,notes,manager_instruction_text,created_at";

/** Read by the model with every room answer, so the roles are never mixed up. */
export const ROOM_PEOPLE_GUIDE =
  "cleanedBy = the housekeeper who cleaned the room. assignedBy = the person who planned/assigned the room to the housekeeper " +
  "(usually a manager; NOT the approver). approvedBy = the supervisor or manager who approved the cleaned room. " +
  "inspection = a supervisor's recheck with its outcome. A null person means it is not recorded: say so, never fill it in from another field.";

export type Person = { name: string; role: string | null };

export type AssignmentView = {
  date: string;
  type: string | null;
  status: string | null;
  cleanedBy: Person | null;
  assignedBy: Person | null;
  approved: boolean;
  approvedBy: Person | null;
  approvedAt: string | null;
  inspection: { outcome: string | null; by: Person | null; at: string | null } | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMinutes: number | null;
  breakMinutes: number | null;
  dnd: { markedBy: Person | null; at: string | null } | null;
  serviceResult: string | null;
  notes: string | null;
  managerInstruction: string | null;
};

/** "10:58" in Budapest, or null. */
export function budapestTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
}

export function personFrom(profile: any): Person | null {
  if (!profile) return null;
  const name = String(profile.full_name || profile.nickname || "").trim() || "Unnamed staff";
  const role = ACCESS_ROLE_LABEL[effectiveAccessRole(profile)] ?? null;
  return { name, role };
}

export function describeAssignment(row: any, people: Map<string, any>): AssignmentView {
  const who = (id: string | null | undefined) => (id ? personFrom(people.get(id)) ?? { name: "Unknown staff", role: null } : null);
  const started = row.started_at ? Date.parse(row.started_at) : NaN;
  const completed = row.completed_at ? Date.parse(row.completed_at) : NaN;
  const breaks = Number(row.total_break_time_minutes ?? 0) || 0;
  const duration = Number.isFinite(started) && Number.isFinite(completed) && completed >= started
    ? Math.max(0, Math.round((completed - started) / 60_000) - breaks)
    : null;
  const reviewed = row.supervisor_reviewed_by || row.supervisor_review_outcome || row.supervisor_reviewed_at;
  return {
    date: String(row.assignment_date),
    type: row.assignment_type ?? null,
    status: row.status ?? null,
    cleanedBy: who(row.assigned_to),
    assignedBy: who(row.assigned_by),
    approved: row.supervisor_approved === true,
    approvedBy: row.supervisor_approved === true || row.supervisor_approved_by ? who(row.supervisor_approved_by) : null,
    approvedAt: budapestTime(row.supervisor_approved_at),
    inspection: reviewed
      ? { outcome: row.supervisor_review_outcome ?? null, by: who(row.supervisor_reviewed_by), at: budapestTime(row.supervisor_reviewed_at) }
      : null,
    startedAt: budapestTime(row.started_at),
    completedAt: budapestTime(row.completed_at),
    durationMinutes: duration,
    breakMinutes: breaks || null,
    dnd: row.is_dnd === true ? { markedBy: who(row.dnd_marked_by), at: budapestTime(row.dnd_marked_at) } : null,
    serviceResult: row.service_result ?? null,
    notes: row.notes ? String(row.notes).slice(0, 300) : null,
    managerInstruction: row.manager_instruction_text ? String(row.manager_instruction_text).slice(0, 300) : null,
  };
}

/** Every profile id an assignment mentions. */
export function peopleIds(rows: any[]): string[] {
  return [...new Set(rows.flatMap((row) => [
    row.assigned_to, row.assigned_by, row.supervisor_approved_by, row.supervisor_reviewed_by, row.dnd_marked_by,
  ]).filter(Boolean))] as string[];
}

export async function loadPeople(service: Service, ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const { data } = await service.from("profiles")
    .select("id,full_name,nickname,role,access_role").in("id", ids).limit(500);
  return new Map((data ?? []).map((p: any) => [p.id, p]));
}

/** Clamp a requested range to at most `maxDays`, newest end first. */
export function clampRange(from: string, to: string, maxDays = 31): { from: string; to: string; clamped: boolean } {
  let start = from <= to ? from : to;
  const end = from <= to ? to : from;
  let clamped = false;
  if (addDays(start, maxDays - 1) < end) {
    start = addDays(end, -(maxDays - 1));
    clamped = true;
  }
  return { from: start, to: end, clamped };
}

/** One room's assignments between two dates (inclusive), newest first. */
export async function roomAssignmentHistory(
  service: Service, opts: { orgSlug: string | null; roomId: string; from: string; to: string },
): Promise<AssignmentView[]> {
  let query = service.from("room_assignments").select(ASSIGNMENT_COLUMNS)
    .eq("room_id", opts.roomId)
    .gte("assignment_date", opts.from)
    .lte("assignment_date", opts.to)
    .order("assignment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.orgSlug) query = query.eq("organization_slug", opts.orgSlug);
  const { data, error } = await query;
  if (error) throw new Error(`Room history lookup failed: ${error.message}`);
  const rows = data ?? [];
  const people = await loadPeople(service, peopleIds(rows));
  return rows.map((row: any) => describeAssignment(row, people));
}
