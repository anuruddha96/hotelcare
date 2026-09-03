// Phase 3 of the HotelCare Copilot: confirmed write actions.
//
// The chat function only ever *proposes* an action (it builds a confirmation
// card). Nothing is written until the user taps Confirm, which calls
// `assistant-apply-action`, where every check below runs again against the
// authenticated session. Both sides import this single module so the rules
// cannot drift apart.

export type AssistantActionKind =
  | "create_ticket"
  | "assign_room_cleaning"
  | "update_ticket_status"
  | "set_min_stay"
  | "edit_revenue_prices";

export type ActionField = { label: string; value: string };

export type ValidatedAction = {
  kind: AssistantActionKind;
  title: string;
  hotelId: string;
  input: Record<string, unknown>;
  fields: ActionField[];
};

const MANAGER_ROLES = [
  "admin",
  "manager",
  "top_management",
  "top_management_manager",
  "housekeeping_manager",
  "maintenance_manager",
  "reception_manager",
  "back_office_manager",
  "supervisor",
];

const REVENUE_WRITE_ROLES = ["admin", "top_management", "top_management_manager"];

const ACTION_ROLES: Record<AssistantActionKind, string[]> = {
  // Anyone who works the floor may raise a maintenance ticket.
  create_ticket: [
    ...MANAGER_ROLES,
    "housekeeping",
    "maintenance",
    "reception",
    "front_office",
    "breakfast_staff",
  ],
  // Only people who run the housekeeping board may hand a room to someone.
  assign_room_cleaning: ["admin", "manager", "top_management", "top_management_manager", "housekeeping_manager", "supervisor"],
  update_ticket_status: [...MANAGER_ROLES, "maintenance"],
  // Revenue calendar writes use the same roles as the existing rate/min-stay
  // publishing endpoints. The assistant never widens those permissions.
  set_min_stay: REVENUE_WRITE_ROLES,
  edit_revenue_prices: REVENUE_WRITE_ROLES,
};

export const ACTION_LABEL: Record<AssistantActionKind, string> = {
  create_ticket: "Create a maintenance ticket",
  assign_room_cleaning: "Assign a room for cleaning",
  update_ticket_status: "Change a ticket's status",
  set_min_stay: "Set Revenue calendar minimum stay and publish it to Previo",
  edit_revenue_prices: "Edit Revenue calendar prices through the safe Previo publishing queue",
};

export function actionsForRole(role: string | null | undefined): AssistantActionKind[] {
  if (!role) return [];
  return (Object.keys(ACTION_ROLES) as AssistantActionKind[]).filter((kind) => ACTION_ROLES[kind].includes(role));
}

export function canRunAction(role: string | null | undefined, kind: string): kind is AssistantActionKind {
  return actionsForRole(role).includes(kind as AssistantActionKind);
}

const PRIORITIES = ["low", "medium", "high", "urgent"];
const STATUSES = ["open", "in_progress", "completed"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function validIsoDate(value: unknown): string {
  const date = text(value, 10);
  if (!ISO_DATE.test(date)) return "";
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function budapestToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function expandDateRange(from: string, to: string, max = 366): string[] | null {
  if (!from || !to || to < from) return null;
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (days < 1 || days > max) return null;
  return Array.from({ length: days }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

function actionDates(raw: Record<string, unknown>): { ok: true; dates: string[] } | { ok: false; error: string } {
  const supplied = Array.isArray(raw.dates)
    ? raw.dates
    : Array.isArray(raw.stayDates)
      ? raw.stayDates
      : [];
  const dates = supplied.map(validIsoDate).filter(Boolean);

  const single = validIsoDate(raw.date ?? raw.stayDate ?? raw.stay_date);
  if (single) dates.push(single);

  const from = validIsoDate(raw.fromDate ?? raw.from ?? raw.startDate);
  const to = validIsoDate(raw.toDate ?? raw.to ?? raw.endDate ?? from);
  if (from) {
    const expanded = expandDateRange(from, to || from);
    if (!expanded) return fail("The minimum-stay date range is invalid or longer than 366 days");
    dates.push(...expanded);
  }

  const unique = [...new Set(dates)].sort();
  if (!unique.length) {
    return fail("Read the Revenue calendar first and pass the exact stay dates that should receive the minimum stay");
  }
  if (unique.length > 366) return fail("A single minimum-stay action can cover at most 366 stay dates");
  const today = budapestToday();
  if (unique.some((date) => date < today)) return fail("Minimum stay can only be changed for today or a future stay date");
  return { ok: true, dates: unique };
}

function displayDateSet(dates: string[]): string {
  if (dates.length === 1) return dates[0];
  const consecutive = dates.every((date, index) => {
    if (index === 0) return true;
    const previous = Date.parse(`${dates[index - 1]}T12:00:00Z`);
    return Date.parse(`${date}T12:00:00Z`) - previous === 86_400_000;
  });
  if (consecutive) return `${dates[0]} → ${dates[dates.length - 1]} (${dates.length} days)`;
  return `${dates.length} dates: ${dates.slice(0, 5).join(", ")}${dates.length > 5 ? ", …" : ""}`;
}

type PriceChange = {
  stay_date: string;
  room_type_name: string;
  occupancy: number;
  old_price: number | null;
  new_price: number;
  obk_id: string | null;
};

function normalizePriceChange(value: unknown): PriceChange | null {
  const row = (value ?? {}) as Record<string, unknown>;
  const stayDate = validIsoDate(row.stay_date ?? row.stayDate ?? row.date);
  const roomTypeName = text(row.room_type_name ?? row.roomTypeName ?? row.roomType, 255);
  const occupancy = Number(row.occupancy ?? row.guests ?? row.pax);
  const newPrice = Number(row.new_price ?? row.newPrice ?? row.price ?? row.targetPrice);
  const oldRaw = row.old_price ?? row.oldPrice ?? row.currentPrice;
  const oldNumber = oldRaw === null || oldRaw === undefined || oldRaw === "" ? null : Number(oldRaw);
  const obkId = text(row.obk_id ?? row.obkId, 255) || null;

  if (!stayDate || !roomTypeName) return null;
  if (!Number.isInteger(occupancy) || occupancy < 1 || occupancy > 30) return null;
  if (!Number.isFinite(newPrice) || newPrice <= 0 || newPrice > 10_000_000) return null;
  if (oldNumber !== null && (!Number.isFinite(oldNumber) || oldNumber <= 0)) return null;

  return {
    stay_date: stayDate,
    room_type_name: roomTypeName,
    occupancy,
    old_price: oldNumber,
    new_price: Math.round(newPrice),
    obk_id: obkId,
  };
}

function priceChanges(raw: Record<string, unknown>): { ok: true; changes: PriceChange[] } | { ok: false; error: string } {
  let candidates: unknown[] = [];
  if (Array.isArray(raw.changes)) candidates = raw.changes;
  else if (Array.isArray(raw.rates)) candidates = raw.rates;
  else if (raw.stay_date || raw.stayDate || raw.date) candidates = [raw];

  if (!candidates.length) return fail("Pass the exact Revenue calendar price cells to change");
  if (candidates.length > 200) return fail("An Assistant price edit can contain at most 200 calendar cells");

  const normalized: PriceChange[] = [];
  for (const candidate of candidates) {
    const change = normalizePriceChange(candidate);
    if (!change) {
      return fail("Each price change needs a valid stay date, room type, occupancy, and positive whole target price");
    }
    normalized.push(change);
  }

  const today = budapestToday();
  if (normalized.some((change) => change.stay_date < today)) return fail("Revenue calendar prices can only be changed for today or a future stay date");

  const deduped = new Map<string, PriceChange>();
  for (const change of normalized) {
    deduped.set(`${change.stay_date}|${change.room_type_name.toLowerCase()}|${change.occupancy}`, change);
  }
  return { ok: true, changes: [...deduped.values()] };
}

/** Shape + range check. Does not touch the database. */
export function validateAction(
  kind: string,
  input: unknown,
): { ok: true; action: Omit<ValidatedAction, "hotelId"> & { hotelId: string } } | { ok: false; error: string } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const hotelId = text(raw.hotelId, 120);
  if (!hotelId) return fail("Name the property this action applies to");

  if (kind === "create_ticket") {
    const title = text(raw.title, 200);
    const description = text(raw.description, 2000);
    const roomNumber = text(raw.roomNumber, 40);
    const priority = text(raw.priority, 20).toLowerCase() || "medium";
    const department = text(raw.department, 40) || "maintenance";
    if (!title) return fail("A short ticket title is required");
    if (!description) return fail("Describe the problem so the technician knows what to expect");
    if (!roomNumber) return fail("A room or location is required");
    if (!PRIORITIES.includes(priority)) return fail(`Priority must be one of ${PRIORITIES.join(", ")}`);
    return {
      ok: true,
      action: {
        kind: "create_ticket",
        hotelId,
        title: "New maintenance ticket",
        input: { hotelId, title, description, roomNumber, priority, department },
        fields: [
          { label: "Room / location", value: roomNumber },
          { label: "Title", value: title },
          { label: "Description", value: description },
          { label: "Priority", value: priority },
          { label: "Department", value: department },
        ],
      },
    };
  }

  if (kind === "assign_room_cleaning") {
    const roomNumber = text(raw.roomNumber, 40);
    const staffId = text(raw.staffId, 64);
    const date = text(raw.date, 10) || new Date().toISOString().slice(0, 10);
    const staffName = text(raw.staffName, 120);
    const assignmentType = text(raw.assignmentType, 30) || "daily_cleaning";
    if (!roomNumber) return fail("Which room should be assigned?");
    if (!/^[0-9a-f-]{36}$/i.test(staffId)) return fail("Pick a housekeeper from the team list first");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("The date must be YYYY-MM-DD");
    if (!["daily_cleaning", "checkout_cleaning"].includes(assignmentType)) {
      return fail("Cleaning type must be daily_cleaning or checkout_cleaning");
    }
    return {
      ok: true,
      action: {
        kind: "assign_room_cleaning",
        hotelId,
        title: "Assign a room for cleaning",
        input: { hotelId, roomNumber, staffId, date, assignmentType },
        fields: [
          { label: "Room", value: roomNumber },
          { label: "Housekeeper", value: staffName || staffId },
          { label: "Date", value: date },
          { label: "Type", value: assignmentType === "checkout_cleaning" ? "Checkout cleaning" : "Daily cleaning" },
        ],
      },
    };
  }

  if (kind === "update_ticket_status") {
    const ticketId = text(raw.ticketId, 64);
    const status = text(raw.status, 20).toLowerCase();
    const note = text(raw.note, 500);
    if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return fail("Read the ticket first so its exact record is known");
    if (!STATUSES.includes(status)) return fail(`Status must be one of ${STATUSES.join(", ")}`);
    return {
      ok: true,
      action: {
        kind: "update_ticket_status",
        hotelId,
        title: "Change a ticket's status",
        input: { hotelId, ticketId, status, note },
        fields: [
          { label: "New status", value: status.replace("_", " ") },
          ...(note ? [{ label: "Note", value: note }] : []),
        ],
      },
    };
  }

  if (kind === "set_min_stay") {
    const nightsRaw = raw.nights ?? raw.minStay ?? raw.min_stay ?? raw.minNights ?? raw.minimumStay;
    const nights = Number(nightsRaw);
    if (!Number.isInteger(nights) || nights < 1 || nights > 30) return fail("Minimum stay must be a whole number from 1 to 30 nights");
    const selected = actionDates(raw);
    if (!selected.ok) return selected;
    return {
      ok: true,
      action: {
        kind: "set_min_stay",
        hotelId,
        title: "Set minimum stay",
        input: { hotelId, nights, dates: selected.dates },
        fields: [
          { label: "Minimum stay", value: `${nights} night${nights === 1 ? "" : "s"}` },
          { label: "Stay dates", value: displayDateSet(selected.dates) },
          { label: "Publishing", value: "Confirm → Previo → HotelCare Revenue calendar" },
        ],
      },
    };
  }

  if (kind === "edit_revenue_prices") {
    const selected = priceChanges(raw);
    if (!selected.ok) return selected;
    const dates = [...new Set(selected.changes.map((change) => change.stay_date))].sort();
    const roomTypes = [...new Set(selected.changes.map((change) => change.room_type_name))];
    const examples = selected.changes
      .slice(0, 3)
      .map((change) => `${change.stay_date} · ${change.room_type_name} · ${change.occupancy} guest${change.occupancy === 1 ? "" : "s"}: €${change.new_price}`)
      .join("; ");
    return {
      ok: true,
      action: {
        kind: "edit_revenue_prices",
        hotelId,
        title: "Edit Revenue calendar prices",
        input: { hotelId, changes: selected.changes },
        fields: [
          { label: "Price cells", value: String(selected.changes.length) },
          { label: "Stay dates", value: displayDateSet(dates) },
          { label: "Room types", value: roomTypes.length <= 3 ? roomTypes.join(", ") : `${roomTypes.length} room types` },
          { label: "Examples", value: `${examples}${selected.changes.length > 3 ? "; …" : ""}` },
          { label: "Publishing", value: "Confirm → safety checks → Previo queue → PMS-confirmed calendar" },
        ],
      },
    };
  }

  return fail("That action is not available");
}

/**
 * Executes a validated non-revenue action with the service client. Caller MUST
 * already have verified the session, role and authorized property. Revenue
 * actions deliberately run in `assistant-apply-action` through the existing
 * authenticated Revenue/Previo Edge Functions, so their safety logic remains
 * the single source of truth.
 */
export async function executeAction(
  service: any,
  ctx: { userId: string; role: string; organizationSlug: string | null; hotelId: string; hotelName: string },
  action: { kind: AssistantActionKind; input: Record<string, unknown> },
): Promise<{ ok: true; summary: string; recordId?: string } | { ok: false; error: string }> {
  const org = ctx.organizationSlug;
  const hotelKeys = [...new Set([ctx.hotelId, ctx.hotelName].filter(Boolean))] as string[];

  if (action.kind === "create_ticket") {
    const { title, description, roomNumber, priority, department } = action.input as Record<string, string>;
    const { data, error } = await service
      .from("tickets")
      .insert({
        ticket_number: `TKT-${Date.now()}`,
        title,
        description,
        room_number: roomNumber,
        priority,
        department,
        status: "open",
        hotel: ctx.hotelName || ctx.hotelId,
        created_by: ctx.userId,
        organization_slug: org,
      })
      .select("id,ticket_number")
      .single();
    if (error) return fail(`The ticket could not be created: ${error.message}`);
    return { ok: true, recordId: data.id, summary: `Ticket ${data.ticket_number} created for room ${roomNumber}` };
  }

  if (action.kind === "assign_room_cleaning") {
    const { roomNumber, staffId, date, assignmentType } = action.input as Record<string, string>;

    const { data: room, error: roomError } = await service
      .from("rooms")
      .select("id,room_number,hotel")
      .eq("organization_slug", org)
      .in("hotel", hotelKeys)
      .eq("room_number", roomNumber)
      .maybeSingle();
    if (roomError) return fail(`Room lookup failed: ${roomError.message}`);
    if (!room) return fail(`Room ${roomNumber} was not found at ${ctx.hotelName || ctx.hotelId}`);

    const { data: staff, error: staffError } = await service
      .from("profiles")
      .select("id,full_name,assigned_hotel,organization_slug")
      .eq("id", staffId)
      .is("deleted_at", null)
      .maybeSingle();
    if (staffError) return fail(`Staff lookup failed: ${staffError.message}`);
    if (!staff || staff.organization_slug !== org) return fail("That staff member is outside your organization");

    const { data: existing, error: findError } = await service
      .from("room_assignments")
      .select("id,assigned_to,status")
      .eq("room_id", room.id)
      .eq("assignment_date", date)
      .maybeSingle();
    if (findError) return fail(`Assignment lookup failed: ${findError.message}`);

    if (existing) {
      if (existing.status === "completed") return fail(`Room ${roomNumber} is already completed for ${date}`);
      if (existing.assigned_to === staffId) {
        return { ok: true, recordId: existing.id, summary: `Room ${roomNumber} was already assigned to ${staff.full_name}` };
      }
      const { error } = await service
        .from("room_assignments")
        .update({ assigned_to: staffId, assigned_by: ctx.userId })
        .eq("id", existing.id);
      if (error) return fail(`The room could not be reassigned: ${error.message}`);
      return { ok: true, recordId: existing.id, summary: `Room ${roomNumber} reassigned to ${staff.full_name} for ${date}` };
    }

    const { data, error } = await service
      .from("room_assignments")
      .insert({
        room_id: room.id,
        assigned_to: staffId,
        assigned_by: ctx.userId,
        assignment_date: date,
        assignment_type: assignmentType,
        status: "assigned",
        organization_slug: org,
      })
      .select("id")
      .single();
    if (error) return fail(`The room could not be assigned: ${error.message}`);
    return { ok: true, recordId: data.id, summary: `Room ${roomNumber} assigned to ${staff.full_name} for ${date}` };
  }

  if (action.kind === "update_ticket_status") {
    const { ticketId, status, note } = action.input as Record<string, string>;
    const { data: ticket, error: ticketError } = await service
      .from("tickets")
      .select("id,ticket_number,status,hotel")
      .eq("id", ticketId)
      .eq("organization_slug", org)
      .in("hotel", hotelKeys)
      .maybeSingle();
    if (ticketError) return fail(`Ticket lookup failed: ${ticketError.message}`);
    if (!ticket) return fail("That ticket is outside your access");
    if (ticket.status === status) return fail(`Ticket ${ticket.ticket_number} is already ${status.replace("_", " ")}`);

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (note) patch.resolution_text = note;
    if (status === "completed") {
      patch.closed_by = ctx.userId;
      patch.closed_at = new Date().toISOString();
    }
    const { error } = await service.from("tickets").update(patch).eq("id", ticketId).eq("organization_slug", org);
    if (error) return fail(`The ticket could not be updated: ${error.message}`);
    return {
      ok: true,
      recordId: ticketId,
      summary: `Ticket ${ticket.ticket_number} moved to ${status.replace("_", " ")}`,
    };
  }

  return fail("That action is not available");
}
