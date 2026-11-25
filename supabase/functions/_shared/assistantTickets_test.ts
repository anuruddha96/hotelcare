import {
  canRunAction,
  cleanRoomReference,
  executeAction,
  looksLikeRoomCode,
  nearestRooms,
  resolveTicketPlace,
  ticketErrorMessage,
  ticketHotelAllowed,
  validateAction,
} from "./assistantActions.ts";

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

type Row = Record<string, unknown>;

/** Minimal chainable stand-in for supabase-js, enough for the ticket path. */
function fakeDb(tables: Record<string, Row[]>, writes: Array<{ table: string; row: Row }>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let inserted: Row | null = null;
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => { rows = rows.filter((r) => r[column] === value); return query; },
        in: (column: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[column])); return query; },
        insert: (row: Row) => { inserted = row; writes.push({ table, row }); return query; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => inserted
          ? {
            data: {
              id: "ticket-1",
              ticket_number: inserted.ticket_number,
              assigned_to: null,
              assignment_method: "unassigned_no_staff_on_duty",
              room_number: inserted.room_number,
            },
            error: null,
          }
          : { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return query;
    },
  };
}

const TABLES: Record<string, Row[]> = {
  organizations: [{ id: "org-rd", slug: "rdhotels" }],
  hotel_configurations: [
    { organization_id: "org-rd", hotel_id: "ottofiori", hotel_name: "Hotel Ottofiori", is_active: true },
    { organization_id: "org-rd", hotel_id: "gozsdu-court", hotel_name: "Gozsdu Court Budapest", is_active: true },
    { organization_id: "org-other", hotel_id: "elsewhere", hotel_name: "Other Org Hotel", is_active: true },
  ],
  rooms: [
    { id: "room-406", hotel: "Hotel Ottofiori", room_number: "406", status: "clean", organization_slug: "rdhotels" },
    { id: "room-405", hotel: "Hotel Ottofiori", room_number: "405", status: "dirty", organization_slug: "rdhotels" },
    { id: "room-407", hotel: "Hotel Ottofiori", room_number: "407", status: "out_of_order", organization_slug: "rdhotels" },
    { id: "room-g1", hotel: "gozsdu-court", room_number: "1B", status: "clean", organization_slug: "rdhotels" },
    { id: "room-g2", hotel: "gozsdu-court", room_number: "2B", status: "clean", organization_slug: "rdhotels" },
  ],
  gozsdu_housekeeping_room_registry: [
    { room_id: "room-g1", pms_room_name: "1B-3/3/5", service_status: "operating" },
    { room_id: "room-g2", pms_room_name: "2B-1/1/1", service_status: "retired" },
  ],
};

Deno.test("Mira offers tickets to exactly the roles the tickets policy allows", () => {
  for (const role of ["top_management_manager", "top_management", "admin", "manager", "housekeeping", "reception", "hr", "control_finance"]) {
    check(canRunAction(role, "create_ticket"), `${role} should be able to raise a ticket`);
  }
  for (const role of ["supervisor", "maintenance_manager", "breakfast_staff", "back_office_manager"]) {
    check(!canRunAction(role, "create_ticket"), `${role} is refused by the tickets policy, so Mira must not offer it`);
  }
});

Deno.test("ticket validation keeps the room, priority and department the app accepts", () => {
  const good = validateAction("create_ticket", {
    hotelId: "ottofiori", roomNumber: "Room 406", title: "Possible water leak in 406",
    description: "Guest reports a possible leak near the washroom.", priority: "High", department: "Maintenance",
  });
  check(good.ok, "A complete ticket must validate");
  if (good.ok) {
    check(good.action.input.roomNumber === "406", "'Room 406' must become room 406");
    check(good.action.input.priority === "high" && good.action.input.department === "maintenance", "Priority/department must be canonical");
    check(good.action.fields[0].label === "Room" && good.action.fields[0].value === "406", "Card must show the room");
    check(good.action.fields.some((f) => f.label === "Priority" && f.value === "High"), "Card shows a readable priority");
  }

  const area = validateAction("create_ticket", {
    hotelId: "ottofiori", roomNumber: "Lobby", title: "Lobby light out", description: "Ceiling light flickers.",
  });
  check(area.ok, "A common area must be accepted");
  if (area.ok) {
    check(area.action.input.roomNumber === "" && area.action.input.location === "Lobby", "'Lobby' is a location, not a room");
    check(area.action.fields[0].value === "Lobby (common area)", "Card labels the common area");
  }

  const aliases = validateAction("create_ticket", {
    hotelId: "h", roomNumber: "12", title: "t", description: "d", priority: "critical", department: "front desk",
  });
  check(aliases.ok && aliases.action.input.priority === "urgent" && aliases.action.input.department === "reception", "Aliases map to app values");
  check(!validateAction("create_ticket", { hotelId: "h", title: "t", description: "d" }).ok, "A ticket needs a room or an area");
  check(!validateAction("create_ticket", { hotelId: "h", roomNumber: "1", title: "t", description: "d", priority: "whenever" }).ok, "Unknown priority is refused");
  check(!validateAction("create_ticket", { hotelId: "h", roomNumber: "1", title: "t", description: "d", department: "IT" }).ok, "Unknown department is refused");
});

Deno.test("room references and suggestions", () => {
  check(cleanRoomReference("Room 406") === "406" && cleanRoomReference("szoba 12") === "12", "Prefixes are removed");
  for (const room of ["406", "A12", "1B-3/3/5", "406a"]) check(looksLikeRoomCode(room), `${room} is a room`);
  for (const area of ["Lobby", "3rd floor corridor", "Breakfast room", "Kitchen2"]) check(!looksLikeRoomCode(area), `${area} is a common area`);
  const near = nearestRooms("4066", ["106", "405", "406", "407", "512"]);
  check(near[0] === "406", `406 should be the first suggestion, got ${near.join(",")}`);
  check(!near.includes("512"), "Unrelated rooms are not suggested");
});

Deno.test("ticket hotel rule mirrors the tickets policy", () => {
  const ottofiori = { hotel_id: "ottofiori", hotel_name: "Hotel Ottofiori" };
  const gozsdu = { hotel_id: "gozsdu-court", hotel_name: "Gozsdu Court Budapest" };
  check(ticketHotelAllowed({ role: "manager", assigned_hotel: "ottofiori" }, ottofiori), "Own hotel by id");
  check(ticketHotelAllowed({ role: "manager", assigned_hotel: "Hotel Ottofiori" }, ottofiori), "Own hotel by name");
  check(!ticketHotelAllowed({ role: "manager", assigned_hotel: "ottofiori" }, gozsdu), "A manager can't file for another hotel");
  check(ticketHotelAllowed({ role: "top_management_manager", assigned_hotel: "ottofiori" }, gozsdu), "Top management may file anywhere");
  check(ticketHotelAllowed({ role: "reception", assigned_hotel: null, is_super_admin: true }, gozsdu), "Super admin may file anywhere");
  check(!ticketHotelAllowed({ role: "reception", assigned_hotel: null }, ottofiori), "No home hotel means no ticket");
});

Deno.test("resolveTicketPlace finds rooms like the Report-issue form", async () => {
  const db = fakeDb(TABLES, []);
  const room = await resolveTicketPlace(db, { organizationSlug: "rdhotels", hotelId: "ottofiori", roomNumber: "406" });
  check(room.ok && room.kind === "room" && room.roomId === "room-406" && room.hotelName === "Hotel Ottofiori", "Room 406 resolves with the canonical hotel name");

  const missing = await resolveTicketPlace(db, { organizationSlug: "rdhotels", hotelId: "ottofiori", roomNumber: "4066" });
  check(!missing.ok && missing.suggestions[0] === "406", "An unknown room comes back with suggestions");
  check(!missing.ok && !missing.suggestions.includes("407"), "Out-of-order rooms are never suggested");

  const broken = await resolveTicketPlace(db, { organizationSlug: "rdhotels", hotelId: "ottofiori", roomNumber: "407" });
  check(!broken.ok && /out of order/.test(broken.error), "Out-of-order rooms are refused like the database guard does");

  const area = await resolveTicketPlace(db, { organizationSlug: "rdhotels", hotelId: "ottofiori", location: "Lobby" });
  check(area.ok && area.kind === "area" && area.location === "Lobby", "A common area needs no room");

  const gozsdu = await resolveTicketPlace(db, { organizationSlug: "rdhotels", hotelId: "Gozsdu Court Budapest", roomNumber: "1b-3/3/5" });
  check(gozsdu.ok && gozsdu.kind === "room" && gozsdu.roomNumber === "1B-3/3/5", "Gozsdu rooms resolve by PMS name");
  const retired = await resolveTicketPlace(db, { organizationSlug: "rdhotels", hotelId: "gozsdu-court", roomNumber: "2B-1/1/1" });
  check(!retired.ok, "A Gozsdu room outside the operating inventory is refused");

  const foreign = await resolveTicketPlace(db, { organizationSlug: "rdhotels", hotelId: "elsewhere", roomNumber: "1" });
  check(!foreign.ok && /not an active hotel of your organization/.test(foreign.error), "Another organization's hotel is refused");
});

Deno.test("create_ticket writes with the person's own session, never the service key", async () => {
  const serviceWrites: Array<{ table: string; row: Row }> = [];
  const userWrites: Array<{ table: string; row: Row }> = [];
  const service = fakeDb(TABLES, serviceWrites);
  const userDb = fakeDb(TABLES, userWrites);
  const ctx = { userId: "user-anu", role: "top_management_manager", organizationSlug: "rdhotels", hotelId: "ottofiori", hotelName: "Hotel Ottofiori" };

  const result = await executeAction(service, ctx, {
    kind: "create_ticket",
    input: { hotelId: "ottofiori", roomNumber: "406", location: "", title: "Possible water leak", description: "Leak near the washroom.", priority: "high", department: "maintenance" },
  }, { userDb });
  check(result.ok, `Ticket should be created: ${!result.ok ? result.error : ""}`);
  check(serviceWrites.length === 0, "The service client must not write the ticket");
  check(userWrites.length === 1 && userWrites[0].table === "tickets", "Exactly one ticket written through the user session");
  const row = userWrites[0].row;
  check(row.created_by === "user-anu" && row.organization_slug === "rdhotels", "Creator and organization are the signed-in user's");
  check(row.source_room_id === "room-406" && row.room_number === "406" && row.hotel === "Hotel Ottofiori", "Canonical room and hotel");
  check(row.source === "manual" && row.priority === "high", "Same source and priority as the form");
  check(result.ok && /maintenance queue/.test(result.summary), "Summary says where the ticket went");

  const areaWrites: Array<{ table: string; row: Row }> = [];
  const area = await executeAction(service, ctx, {
    kind: "create_ticket",
    input: { hotelId: "ottofiori", roomNumber: "", location: "Lobby", title: "Light out", description: "Ceiling light flickers.", priority: "medium", department: "maintenance" },
  }, { userDb: fakeDb(TABLES, areaWrites) });
  check(area.ok, "Common-area ticket should be created");
  check(areaWrites[0].row.room_number === "N/A" && areaWrites[0].row.source_room_id === null, "Common areas have no room");
  check(String(areaWrites[0].row.description).startsWith("Location: Lobby\n"), "The guard's Location: prefix is written");

  const noSession = await executeAction(service, ctx, {
    kind: "create_ticket",
    input: { hotelId: "ottofiori", roomNumber: "406", title: "t", description: "d", priority: "low", department: "maintenance" },
  });
  check(!noSession.ok, "Without the user's session no ticket is written");

  const unknownRoom = await executeAction(service, ctx, {
    kind: "create_ticket",
    input: { hotelId: "ottofiori", roomNumber: "4066", title: "t", description: "d", priority: "low", department: "maintenance" },
  }, { userDb });
  check(!unknownRoom.ok && /Did you mean 406/.test(unknownRoom.error), "An unknown room explains and suggests");
});

Deno.test("database refusals are explained plainly", () => {
  check(/own hotel/.test(ticketErrorMessage({ message: "new row violates row-level security policy for table \"tickets\"" }, "Hotel Ottofiori")), "RLS refusal is explained");
  check(/could not be created: Room is unknown/.test(ticketErrorMessage({ message: "Room is unknown or ambiguous; refresh and select the room" }, "X")), "Guard text is kept");
  check(/Nothing was created/.test(ticketErrorMessage(null, "X")), "Empty error still says nothing was created");
});
