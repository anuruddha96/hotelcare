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
