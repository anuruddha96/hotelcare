import {
  restaurantHotelAllowed, restaurantStatusTransition, RESTAURANT_UUID,
  type RestaurantStaffProfile,
} from "./restaurantStaffAuth.ts";

const basic: RestaurantStaffProfile = {
  role: "breakfast_staff", assigned_hotel: "memories-budapest", hotel_id: null,
  organization_slug: "rdhotels", is_super_admin: false, deleted_at: null,
  full_name: "Breakfast staff", nickname: null,
};
const UUID = "a4a4a4a4-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const allowed = (profile: RestaurantStaffProfile, slug="rdhotels", code="memories-budapest") =>
  restaurantHotelAllowed(profile, slug, code, "Hotel Memories Budapest", UUID);

Deno.test("validates UUID identifiers and does not treat arbitrary room codes as canonical IDs", () => {
  if (!RESTAURANT_UUID.test(UUID) || RESTAURANT_UUID.test("memories-budapest")) throw Error("UUID validation failed");
});

Deno.test("breakfast staff can access only their own organization's assigned property", () => {
  if (!allowed(basic)) throw Error("Own hotel must be accessible");
  if (allowed(basic, "another-tenant")) throw Error("Cross-tenant access must fail");
  if (allowed(basic, "rdhotels", "hotel-mika")) throw Error("Other hotel must fail");
});

Deno.test("alternate assigned hotel identifiers are recognized without relaxing tenant protection", () => {
  if (!allowed({ ...basic, assigned_hotel: UUID })) throw Error("Canonical assignment failed");
  if (!allowed({ ...basic, assigned_hotel: "Hotel Memories Budapest" })) throw Error("Named assignment failed");
  if (allowed({ ...basic, assigned_hotel: null, hotel_id: null })) throw Error("Unassigned staff must fail");
});

Deno.test("executives span properties in their own tenant, but not other tenants", () => {
  const executive = { ...basic, role: "top_management", assigned_hotel: null };
  if (!allowed(executive, "rdhotels", "hotel-mika")) throw Error("Executive must have tenant-wide permission");
  if (allowed(executive, "different-org", "hotel-mika")) throw Error("Cross-tenant executive access must fail");
  if (!allowed({ ...executive, is_super_admin: true }, "different-org", "hotel-mika")) throw Error("Super admin access failed");
});

Deno.test("deleted and unrecognized roles are denied", () => {
  if (allowed({ ...basic, deleted_at: new Date().toISOString() })) throw Error("Deleted staff allowed");
  if (allowed({ ...basic, role: "housekeeping" })) throw Error("Wrong role allowed");
});

Deno.test("reservation status transitions require explicit confirmation for corrections", () => {
  if (!restaurantStatusTransition("booked", "seated", false) ||
      !restaurantStatusTransition("booked", "no_show", false)) throw Error("Normal arrival/no-show blocked");
  if (restaurantStatusTransition("seated", "no_show", false) ||
      restaurantStatusTransition("no_show", "booked", false)) throw Error("Unconfirmed correction allowed");
  if (!restaurantStatusTransition("seated", "no_show", true) ||
      !restaurantStatusTransition("no_show", "booked", true)) throw Error("Confirmed correction blocked");
  if (restaurantStatusTransition("cancelled", "booked", true) ||
      restaurantStatusTransition("completed", "seated", true) ||
      restaurantStatusTransition("booked", "cancelled", true)) throw Error("Forbidden transition allowed");
});

Deno.test("authenticates only verified users with an active permitted profile", async () => {
  const { authenticateRestaurantStaff } = await import("./restaurantStaffAuth.ts");
  function dbFor(user: unknown, profile: unknown) {
    return {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: (_table: string) => ({
        select: (_fields: string) => ({
          eq: (_field: string, _value: string) => ({
            maybeSingle: async () => ({ data: profile, error: null }),
          }),
        }),
      }),
    };
  }
  const request = (authorization?: string) =>
    new Request("https://example.invalid", {
      method: "POST", headers: authorization ? { Authorization: authorization } : {},
    });
  const validUser = { id: UUID, email: "staff@example.invalid" };
  const anon = await authenticateRestaurantStaff(request(), dbFor(validUser, basic));
  if (anon.ok || anon.status !== 401) throw Error("Anonymous caller was accepted");
  const missing = await authenticateRestaurantStaff(request("Bearer a-staff-token"), dbFor(null, basic));
  if (missing.ok || missing.status !== 401) throw Error("Invalid token was accepted");
  const denied = await authenticateRestaurantStaff(request("Bearer a-staff-token"),
    dbFor(validUser, { ...basic, deleted_at: new Date().toISOString() }));
  if (denied.ok || denied.status !== 403) throw Error("Deleted staff profile was accepted");
  const granted = await authenticateRestaurantStaff(request("Bearer a-staff-token"), dbFor(validUser, basic));
  if (!granted.ok || granted.actor.userId !== UUID || granted.actor.displayName !== "Breakfast staff")
    throw Error("Verified staff identity was not used");
});

Deno.test("maps property code to canonical hotel only after organization/assignment checks", async () => {
  const { authorizeRestaurantHotel } = await import("./restaurantStaffAuth.ts");
  const tables: Record<string, Array<Record<string, unknown>>> = {
    hotel_configurations: [
      { hotel_id: "memories-budapest", hotel_name: "Hotel Memories Budapest", organization_id: "org-1", is_active: true },
    ],
    hotels: [{ id: UUID, name: "Hotel Memories Budapest" }],
    organizations: [{ id: "org-1", slug: "rdhotels" }],
    restaurant_webhook_sources: [{ hotel_id: UUID, property_slug: "memories", is_active: true }],
  };
  const fakeDb = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const query = {
        select(_columns: string) { return query; },
        eq(column: string, value: unknown) {
          filters.push(row => row[column] === value);
          return query;
        },
        ilike(column: string, value: string) {
          filters.push(row => String(row[column] ?? "").toLowerCase() === value.toLowerCase());
          return query;
        },
        async maybeSingle() {
          const found = (tables[table] ?? []).filter(row => filters.every(predicate => predicate(row)));
          return { data: found.length === 1 ? found[0] : null, error: found.length > 1 ? { message: "ambiguous" } : null };
        },
      };
      return query;
    },
  };
  const actor = { userId: UUID, displayName: "Breakfast staff", profile: basic };
  const valid = await authorizeRestaurantHotel(fakeDb, actor, "memories-budapest");
  if (!valid.ok || valid.hotel.reservationHotelId !== UUID || valid.hotel.propertySlug !== "memories")
    throw Error("Verified property mapping failed");
  const denied = await authorizeRestaurantHotel(fakeDb, {
    ...actor, profile: { ...basic, organization_slug: "another-tenant" },
  }, UUID);
  if (denied.ok || denied.status !== 403) throw Error("Cross-tenant canonical UUID was accepted");
});
