// Phase 3 of the HotelCare Copilot: operational write actions.
//
// The chat function only ever *proposes* an action (it builds a confirmation
// card). Nothing is written until the user taps Confirm, which calls
// `assistant-apply-action`, where every check below runs again against the
// authenticated session. Both sides import this single module so the rules
// cannot drift apart.

export type AssistantActionKind = "create_ticket" | "assign_room_cleaning" | "update_ticket_status";

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
};

export const ACTION_LABEL: Record<AssistantActionKind, string> = {
  create_ticket: "Create a maintenance ticket",
  assign_room_cleaning: "Assign a room for cleaning",
  update_ticket_status: "Change a ticket's status",
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

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
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

  return fail("That action is not available");
}

/**
 * Executes a validated action with the service client. Caller MUST already have
 * verified the session, the role and that `hotelId` is inside the user's
 * authorized properties.
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
