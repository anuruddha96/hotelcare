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
  | "edit_revenue_prices"
  | "create_guest_request"
  | "set_bed_configuration"
  | "adjust_revenue_prices";

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

// The same permission levels as the tickets INSERT policy ("Secure ticket
// creation"): Mira never offers a ticket the Report-issue form would refuse.
export const TICKET_CREATOR_ROLES = [
  "admin",
  "top_management",
  "top_management_manager",
  "manager",
  "housekeeping_manager",
  "housekeeping",
  "reception",
  "front_office",
  "maintenance",
  "marketing",
  "control_finance",
  "hr",
];
/** May raise a ticket for any hotel of their organization (others: own hotel only). */
const TICKET_ANY_HOTEL_ROLES = ["admin", "top_management", "top_management_manager"];

const ACTION_ROLES: Record<AssistantActionKind, string[]> = {
  create_ticket: TICKET_CREATOR_ROLES,
  // Only people who run the housekeeping board may hand a room to someone.
  assign_room_cleaning: ["admin", "manager", "top_management", "top_management_manager", "housekeeping_manager", "supervisor"],
  update_ticket_status: [...MANAGER_ROLES, "maintenance"],
  // Revenue calendar writes use the same roles as the existing rate/min-stay
  // publishing endpoints. The assistant never widens those permissions.
  set_min_stay: REVENUE_WRITE_ROLES,
  edit_revenue_prices: REVENUE_WRITE_ROLES,
  adjust_revenue_prices: REVENUE_WRITE_ROLES,
  create_guest_request: [...MANAGER_ROLES, "reception", "front_office", "housekeeping"],
  set_bed_configuration: [...MANAGER_ROLES, "reception", "front_office"],
};

export const ACTION_LABEL: Record<AssistantActionKind, string> = {
  create_ticket: "Create a maintenance ticket",
  assign_room_cleaning: "Assign a room for cleaning",
  update_ticket_status: "Change a ticket's status",
  set_min_stay: "Set Revenue calendar minimum stay and publish it to Previo",
  edit_revenue_prices: "Edit Revenue calendar prices through the safe Previo publishing queue",
  adjust_revenue_prices: "Adjust verified Revenue calendar prices by a fixed euro amount",
  create_guest_request: "Send a guest room-item request to housekeeping",
  set_bed_configuration: "Update room bed setup for housekeeping",
};

export function actionsForRole(role: string | null | undefined): AssistantActionKind[] {
  if (!role) return [];
  return (Object.keys(ACTION_ROLES) as AssistantActionKind[]).filter((kind) => ACTION_ROLES[kind].includes(role));
}

export function canRunAction(role: string | null | undefined, kind: string): kind is AssistantActionKind {
  return actionsForRole(role).includes(kind as AssistantActionKind);
}

const PRIORITIES = ["low", "medium", "high", "urgent"];
const PRIORITY_ALIASES: Record<string, string> = {
  normal: "medium", standard: "medium", moderate: "medium",
  minor: "low", cosmetic: "low",
  critical: "urgent", emergency: "urgent", asap: "urgent", immediate: "urgent",
};
// Departments of the Report-issue form (CreateTicketDialog).
export const TICKET_DEPARTMENTS: Record<string, string> = {
  maintenance: "Maintenance",
  housekeeping: "Housekeeping",
  reception: "Reception",
  marketing: "Marketing",
  back_office: "Back Office",
  control: "Control",
  finance: "Finance",
  top_management: "Top Management",
};
const DEPARTMENT_ALIASES: Record<string, string> = {
  technical: "maintenance", technician: "maintenance", engineering: "maintenance", repair: "maintenance",
  front_office: "reception", front_desk: "reception", frontdesk: "reception",
  hk: "housekeeping", cleaning: "housekeeping",
  backoffice: "back_office", management: "top_management",
};
const STATUSES = ["open", "in_progress", "completed"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

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

  if (kind === "create_guest_request") {
    const roomNumber = text(raw.roomNumber, 40);
    const requestType = text(raw.requestType, 30) || "other";
    const quantities = Number(raw.quantity ?? 1);
    const detail = text(raw.detail, 500);
    const labels: Record<string, string> = {
      extra_towels: "Extra towels", extra_pillow: "Extra pillow", blanket: "Blanket",
      baby_cot: "Baby cot", iron: "Iron", amenities: "Extra amenities", other: "Other request",
    };
    if (!roomNumber) return fail("Specify the room number.");
    if (!labels[requestType]) return fail("Select an available guest request type.");
    if (!Number.isInteger(quantities) || quantities < 1 || quantities > 20) return fail("Quantity must be 1–20.");
    return { ok: true, action: {
      kind: "create_guest_request", hotelId, title: "Guest room request",
      input: { hotelId, roomNumber, requestType, quantity: quantities, detail },
      fields: [{ label: "Room", value: roomNumber }, { label: "Items", value: `${labels[requestType]} ×${quantities}` }],
    } };
  }

  if (kind === "set_bed_configuration") {
    const roomNumber = text(raw.roomNumber, 40);
    const configuration = text(raw.configuration, 50);
    const values = ["Double Bed", "Twin Beds", "Twin Beds Separated", "Single Bed", "Baby Bed", "Sofa Bed", "Extra Cot Added"];
    if (!roomNumber) return fail("Specify the room number.");
    if (!values.includes(configuration)) return fail("Choose a supported bed setup; for beds together, use Double Bed.");
    return { ok: true, action: {
      kind: "set_bed_configuration", hotelId, title: "Update bed setup",
      input: { hotelId, roomNumber, configuration },
      fields: [{ label: "Room", value: roomNumber }, { label: "Bed setup", value: configuration }],
    } };
  }

  if (kind === "adjust_revenue_prices") {
    const from = validIsoDate(raw.fromDate);
    const to = validIsoDate(raw.toDate);
    const delta = Number(raw.deltaEur);
    const dates = from && to ? expandDateRange(from, to, 7) : null;
    if (!dates || dates.some(d => d < budapestToday())) return fail("Use an exact future date range of 1–7 days.");
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 20) return fail("Use a whole euro adjustment between -20 and +20.");
    return { ok: true, action: {
      kind: "adjust_revenue_prices", hotelId, title: "Adjust daily prices",
      input: { hotelId, fromDate: from, toDate: to, deltaEur: delta },
      fields: [{ label: "Dates", value: displayDateSet(dates) }, { label: "Change", value: `${delta > 0 ? "+" : ""}${delta} EUR per eligible price cell` }],
    } };
  }

  if (kind === "create_ticket") {
    const title = text(raw.title, 200);
    const description = text(raw.description, 2000);
    let roomNumber = cleanRoomReference(text(raw.roomNumber ?? raw.room ?? raw.room_number, 40));
    let location = text(raw.location ?? raw.area ?? raw.commonArea, 80);
    // "Lobby" or "3rd floor corridor" in the room field is a common area.
    if (roomNumber && !looksLikeRoomCode(roomNumber)) {
      location = location || roomNumber;
      roomNumber = "";
    }
    if (/^(?:n\/?a|none|-)$/i.test(location)) location = "";
    const rawPriority = text(raw.priority, 20).toLowerCase();
    const priority = PRIORITY_ALIASES[rawPriority] ?? (rawPriority || "medium");
    const rawDepartment = text(raw.department, 40).toLowerCase().replace(/[\s-]+/g, "_");
    const department = !rawDepartment ? "maintenance" : (DEPARTMENT_ALIASES[rawDepartment] ?? rawDepartment);
    if (!title) return fail("A short ticket title is required");
    if (!description) return fail("Describe the problem so the technician knows what to expect");
    if (!roomNumber && !location) return fail("Say which room, or which common area such as the lobby, has the problem");
    if (!PRIORITIES.includes(priority)) return fail(`Priority must be one of ${PRIORITIES.join(", ")}`);
    if (!TICKET_DEPARTMENTS[department]) {
      return fail(`Department must be one of ${Object.keys(TICKET_DEPARTMENTS).join(", ")}`);
    }
    return {
      ok: true,
      action: {
        kind: "create_ticket",
        hotelId,
        title: "New maintenance ticket",
        input: { hotelId, title, description, roomNumber, location, priority, department },
        fields: [
          { label: roomNumber ? "Room" : "Location", value: roomNumber || `${location} (common area)` },
          { label: "Title", value: title },
          { label: "Description", value: description },
          { label: "Priority", value: capitalize(priority) },
          { label: "Department", value: TICKET_DEPARTMENTS[department] },
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

// ---------------------------------------------------------------------------
// Maintenance tickets: where the problem is, and who may file it.
// ---------------------------------------------------------------------------

/** "Room 406" → "406". */
export function cleanRoomReference(value: string): string {
  return String(value ?? "").replace(/^(?:room|rm|szoba|apartment|apt|no\.?|nr\.?|#)\s*/i, "").trim();
}

/** "406", "A12", "1B-3/3/5" are rooms; "Lobby" or "3rd floor corridor" are common areas. */
export function looksLikeRoomCode(value: string): boolean {
  const cleaned = cleanRoomReference(value);
  return cleaned.length > 0 && cleaned.length <= 24 && !/\s/.test(cleaned) && /^[\p{L}]{0,3}\d/u.test(cleaned);
}

/** Rooms that look like what the person meant, best first (for "did you mean"). */
export function nearestRooms(input: string, labels: readonly string[], limit = 4): string[] {
  const needle = cleanRoomReference(input).toLowerCase();
  if (!needle) return [];
  const needleDigits = needle.replace(/\D/g, "");
  const scored = [...new Set(labels.map((l) => String(l ?? "").trim()).filter(Boolean))].map((label) => {
    const value = label.toLowerCase();
    let score = 0;
    if (value.startsWith(needle) || needle.startsWith(value)) score += 3;
    else if (value.includes(needle) || needle.includes(value)) score += 2;
    let prefix = 0;
    while (prefix < value.length && prefix < needle.length && value[prefix] === needle[prefix]) prefix += 1;
    score += prefix * 0.5;
    const digits = value.replace(/\D/g, "");
    if (needleDigits && digits && digits.length === needleDigits.length) {
      const distance = Math.abs(Number(digits) - Number(needleDigits));
      if (distance <= 10) score += 2 - distance / 10;
    }
    return { label, score };
  });
  return scored
    .filter((row) => row.score >= 1)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, undefined, { numeric: true }))
    .slice(0, limit)
    .map((row) => row.label);
}

/** Mirrors the tickets INSERT policy: top management any hotel of the organization, others their own hotel. */
export function ticketHotelAllowed(
  profile: { role?: string | null; assigned_hotel?: string | null; is_super_admin?: boolean | null },
  hotel: { hotel_id: string; hotel_name?: string | null },
): boolean {
  if (profile.is_super_admin === true) return true;
  if (TICKET_ANY_HOTEL_ROLES.includes(String(profile.role ?? ""))) return true;
  const home = String(profile.assigned_hotel ?? "").trim().toLowerCase();
  if (!home) return false;
  return [hotel.hotel_id, hotel.hotel_name].some((key) => String(key ?? "").trim().toLowerCase() === home);
}

export function formatChoices(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

export type TicketPlace =
  | { ok: true; kind: "room"; roomId: string; roomNumber: string; hotelId: string; hotelName: string }
  | { ok: true; kind: "area"; location: string; hotelId: string; hotelName: string }
  | { ok: false; error: string; suggestions: string[] };

const UNAVAILABLE_ROOM_STATUSES = new Set(["out_of_order", "unavailable", "decommissioned"]);
const GOZSDU_HOTEL_KEYS = new Set(["gozsdu-court", "gozsdu court budapest"]);

/**
 * Resolves the hotel and the room (or common area) of a ticket exactly like the
 * Report-issue form: the hotel's canonical name, operating Gozsdu rooms by
 * their PMS name, and no out-of-order rooms. Read-only.
 */
export async function resolveTicketPlace(service: any, params: {
  organizationSlug: string | null;
  hotelId: string;
  hotelName?: string | null;
  roomNumber?: string | null;
  location?: string | null;
}): Promise<TicketPlace> {
  const unavailable = (error: string): TicketPlace => ({ ok: false, error, suggestions: [] });
  const org = params.organizationSlug;
  if (!org) return unavailable("Your account has no organization, so HotelCare cannot file this ticket.");

  const { data: orgRow, error: orgError } = await service.from("organizations").select("id").eq("slug", org).maybeSingle();
  if (orgError || !orgRow?.id) return unavailable("HotelCare could not verify your organization just now. Try again.");
  const { data: configs, error: configError } = await service.from("hotel_configurations")
    .select("hotel_id,hotel_name").eq("organization_id", orgRow.id).eq("is_active", true);
  if (configError) return unavailable("HotelCare could not verify the hotel just now. Try again.");
  const wanted = [params.hotelId, params.hotelName].filter(Boolean).map((v) => String(v).trim().toLowerCase());
  const hotel = (configs ?? []).find((h: any) =>
    wanted.includes(String(h.hotel_id ?? "").toLowerCase()) || wanted.includes(String(h.hotel_name ?? "").toLowerCase()));
  if (!hotel) return unavailable(`${params.hotelName || params.hotelId} is not an active hotel of your organization.`);
  const hotelId = String(hotel.hotel_id);
  const hotelName = String(hotel.hotel_name || hotel.hotel_id);

  const roomText = cleanRoomReference(String(params.roomNumber ?? ""));
  const areaText = String(params.location ?? "").replace(/\s+/g, " ").trim();
  if (!roomText || !looksLikeRoomCode(roomText)) {
    const area = (areaText || roomText).slice(0, 80);
    if (!area || /^(?:n\/?a|none|-)$/i.test(area)) return unavailable("Say which room or which common area has the problem.");
    return { ok: true, kind: "area", location: area, hotelId, hotelName };
  }

  const keys = [...new Set([hotel.hotel_id, hotel.hotel_name].filter(Boolean).map(String))];
  const { data: rooms, error: roomError } = await service.from("rooms")
    .select("id,hotel,room_number,status").eq("organization_slug", org).in("hotel", keys);
  if (roomError) return unavailable("HotelCare could not read the room list just now. Try again.");

  type Candidate = { id: string; label: string; alias: string; status: string };
  let candidates: Candidate[];
  if (GOZSDU_HOTEL_KEYS.has(hotelId.toLowerCase()) || GOZSDU_HOTEL_KEYS.has(hotelName.toLowerCase())) {
    // Gozsdu rooms are known by their PMS name and must be in the operating inventory.
    const ids = (rooms ?? []).map((r: any) => r.id);
    const { data: registry, error: registryError } = ids.length
      ? await service.from("gozsdu_housekeeping_room_registry").select("room_id,pms_room_name,service_status").in("room_id", ids)
      : { data: [], error: null };
    if (registryError) return unavailable("HotelCare could not read the Gozsdu room list just now. Try again.");
    const byRoom = new Map((registry ?? []).map((g: any) => [g.room_id, g]));
    candidates = (rooms ?? []).flatMap((r: any) => {
      const entry: any = byRoom.get(r.id);
      const name = String(entry?.pms_room_name ?? "").trim();
      return entry?.service_status === "operating" && name
        ? [{ id: r.id, label: name, alias: String(r.room_number ?? "").trim(), status: "operating" }]
        : [];
    });
  } else {
    candidates = (rooms ?? []).map((r: any) => ({
      id: r.id,
      label: String(r.room_number ?? "").trim(),
      alias: "",
      status: String(r.status ?? "").toLowerCase(),
    })).filter((r: Candidate) => r.label);
  }

  const needle = roomText.toLowerCase();
  const matches = [...new Map(candidates
    .filter((r) => r.label.toLowerCase() === needle || (r.alias && r.alias.toLowerCase() === needle))
    .map((r) => [r.id, r])).values()];
  if (matches.length === 1) {
    const room = matches[0];
    if (UNAVAILABLE_ROOM_STATUSES.has(room.status)) {
      return unavailable(`Room ${room.label} is marked ${room.status.replace(/_/g, " ")} in HotelCare, so it can't take a new maintenance ticket.`);
    }
    return { ok: true, kind: "room", roomId: room.id, roomNumber: room.label, hotelId, hotelName };
  }
  if (matches.length > 1) {
    return { ok: false, error: `More than one room at ${hotelName} matches "${roomText}".`, suggestions: matches.slice(0, 4).map((r) => r.label) };
  }
  return {
    ok: false,
    error: `Room ${roomText} was not found at ${hotelName}.`,
    suggestions: nearestRooms(roomText, candidates.filter((r) => !UNAVAILABLE_ROOM_STATUSES.has(r.status)).map((r) => r.label)),
  };
}

/** A database refusal, said the way a colleague would say it. */
export function ticketErrorMessage(error: { message?: string | null } | null | undefined, hotelName: string): string {
  const message = String(error?.message ?? "").trim();
  if (/row-level security/i.test(message)) {
    return `Your HotelCare role can't create tickets for ${hotelName}. You can raise tickets for your own hotel; top management can raise them for any hotel.`;
  }
  if (!message) return "HotelCare did not confirm the ticket. Nothing was created; please try again.";
  return `The ticket could not be created: ${message}`;
}

/**
 * Executes a validated non-revenue action. Caller MUST already have verified
 * the session, role and authorized property. Revenue actions deliberately run
 * in `assistant-apply-action` through the existing authenticated Revenue/Previo
 * Edge Functions, so their safety logic remains the single source of truth.
 *
 * Tickets are written with the person's own session (`userDb`), exactly like
 * the Report-issue form: row-level security and the room-eligibility trigger
 * (which requires auth.uid() to be the creator) decide as they do in the app.
 */
export async function executeAction(
  service: any,
  ctx: { userId: string; role: string; organizationSlug: string | null; hotelId: string; hotelName: string },
  action: { kind: AssistantActionKind; input: Record<string, unknown> },
  options: { userDb?: any } = {},
): Promise<{ ok: true; summary: string; recordId?: string } | { ok: false; error: string }> {
  const org = ctx.organizationSlug;
  const hotelKeys = [...new Set([ctx.hotelId, ctx.hotelName].filter(Boolean))] as string[];

  if (action.kind === "create_guest_request" || action.kind === "set_bed_configuration") {
    const roomNumber = String(action.input.roomNumber ?? "");
    const { data: rooms, error: roomError } = await service.from("rooms")
      .select("id,room_number,hotel,bed_configuration")
      .eq("organization_slug", org).in("hotel", hotelKeys).eq("room_number", roomNumber).limit(2);
    if (roomError) return fail(`Room lookup failed: ${roomError.message}`);
    if (!rooms?.length) return fail(`Room ${roomNumber} was not found at this property.`);
    if (rooms.length !== 1) return fail("Room number is ambiguous within this hotel; no action was taken.");
    const room = rooms[0];

    if (action.kind === "set_bed_configuration") {
      const configuration = String(action.input.configuration);
      if (room.bed_configuration === configuration)
        return { ok: true, recordId: room.id, summary: `Room ${roomNumber} already has ${configuration} selected. No change needed.` };
      // Optimistic compare-and-swap: never overwrite a change made by a manager mid-request.
      let update = service.from("rooms").update({ bed_configuration: configuration })
        .eq("id", room.id).eq("organization_slug", org);
      update = room.bed_configuration === null ? update.is("bed_configuration", null)
        : update.eq("bed_configuration", room.bed_configuration);
      const { data: changed, error } = await update.select("id,bed_configuration").maybeSingle();
      if (error) return fail(`Bed setup was not saved: ${error.message}`);
      if (!changed || changed.bed_configuration !== configuration)
        return fail("The room changed during this request. Refresh its current setup before retrying.");
      return { ok: true, recordId: room.id,
        summary: `Room ${roomNumber}: bed setup saved as ${configuration} for housekeeping.` };
    }

    const type = String(action.input.requestType);
    const quantity = Number(action.input.quantity);
    const labels: Record<string, string> = {
      extra_towels: "Extra towels", extra_pillow: "Extra pillow", blanket: "Blanket",
      baby_cot: "Baby cot", iron: "Iron", amenities: "Extra amenities", other: "Other request",
    };
    const day = budapestToday(), now = new Date().toISOString();
    const { data: assignments, error: assignmentError } = await service.from("room_assignments")
      .select("id,assigned_to,status,created_at").eq("room_id", room.id)
      .eq("assignment_date", day).neq("status", "cancelled")
      .order("created_at", { ascending: false }).limit(10);
    if (assignmentError) return fail("Could not verify today's room assignment; the request was not sent.");
    const assigned = assignments?.find((a: any) => a.assigned_to && a.status !== "completed")
      ?? assignments?.find((a: any) => a.assigned_to) ?? null;
    let workerName: string | null = null, attendanceStatus: string | null = null, active = false;
    if (assigned?.assigned_to) {
      const [{ data: person }, { data: attendance, error: attendanceError }] = await Promise.all([
        service.from("profiles").select("full_name,nickname,organization_slug,deleted_at")
          .eq("id", assigned.assigned_to).maybeSingle(),
        service.from("staff_attendance").select("status,check_out_time")
          .eq("user_id", assigned.assigned_to).eq("work_date", day)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (person && person.organization_slug === org && !person.deleted_at) {
        workerName = person.nickname || person.full_name || "Assigned housekeeper";
        if (!attendanceError && attendance) {
          attendanceStatus = attendance.status ?? null;
          active = !attendance.check_out_time && ["checked_in", "on_break"].includes(attendance.status);
        }
      }
    }
    const payload = {
      version: 1, workDate: day, requestType: type, label: labels[type],
      quantity, requiresReturn: !["amenities", "other"].includes(type),
      status: "requested", detail: String(action.input.detail ?? ""),
      events: [{ status: "requested", actorId: ctx.userId, at: now }],
      targetAssignmentId: assigned?.id ?? null,
      targetHousekeeperId: assigned?.assigned_to ?? null,
      targetHousekeeperName: workerName,
      targetAttendanceStatus: attendanceStatus,
      targetWasActive: active,
    };
    const { data: saved, error } = await service.from("housekeeping_notes").insert({
      room_id: room.id, assignment_id: assigned?.id ?? null, note_type: "guest_request",
      content: JSON.stringify(payload), created_by: ctx.userId, is_resolved: false,
    }).select("id").single();
    if (error || !saved) return fail(`Guest request was not recorded: ${error?.message ?? "Unknown error"}`);
    return { ok: true, recordId: saved.id,
      summary: `${labels[type]} ×${quantity} recorded for room ${roomNumber}. ${active
        ? `Routed to ${workerName}'s active housekeeping view; delivery has not yet been confirmed.`
        : "No active assigned housekeeper could be verified; the request is saved, but an immediate notification is not confirmed."}` };
  }

  if (action.kind === "create_ticket") {
    const { userDb } = options;
    if (!userDb) return fail("HotelCare needs your own session to file this ticket. Refresh the page and try again.");
    const input = action.input as Record<string, string>;
    const place = await resolveTicketPlace(service, {
      organizationSlug: org,
      hotelId: ctx.hotelId,
      hotelName: ctx.hotelName,
      roomNumber: input.roomNumber,
      location: input.location,
    });
    if (!place.ok) {
      return fail(place.suggestions.length ? `${place.error} Did you mean ${formatChoices(place.suggestions)}?` : place.error);
    }
    const department = String(input.department || "maintenance");
    // The same row the Report-issue form writes (CreateTicketDialog).
    const { data, error } = await userDb
      .from("tickets")
      .insert({
        title: input.title,
        description: place.kind === "area" ? `Location: ${place.location}\n${input.description}` : input.description,
        room_number: place.kind === "room" ? place.roomNumber : "N/A",
        source_room_id: place.kind === "room" ? place.roomId : null,
        priority: input.priority,
        department,
        hotel: place.hotelName,
        created_by: ctx.userId,
        ticket_number: `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        attachment_urls: null,
        assigned_to: null,
        organization_slug: org,
        source: "manual",
        assignment_method: null,
      })
      .select("id,ticket_number,assigned_to,assignment_method,room_number")
      .single();
    if (error || !data) return fail(ticketErrorMessage(error, place.hotelName));

    let routed = "";
    if (data.assigned_to) {
      const { data: person } = await service.from("profiles").select("full_name,nickname").eq("id", data.assigned_to).maybeSingle();
      routed = ` Assigned to ${person?.full_name || person?.nickname || "a maintenance colleague"}.`;
    } else if (department === "maintenance") {
      routed = /no_staff|no_one|off_duty/i.test(String(data.assignment_method ?? ""))
        ? " No maintenance colleague is signed in, so it waits in the maintenance queue."
        : " It is in the maintenance queue.";
    }
    const where = place.kind === "room" ? `room ${data.room_number || place.roomNumber}` : place.location;
    return {
      ok: true,
      recordId: data.id,
      summary: `Ticket ${data.ticket_number} created for ${where} at ${place.hotelName}.${routed}`,
    };
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
