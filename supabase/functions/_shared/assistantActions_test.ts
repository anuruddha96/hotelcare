import { actionsForRole, canRunAction, validateAction } from "./assistantActions.ts";

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("reception can request towels but not modify revenue", () => {
  check(canRunAction("reception", "create_guest_request"), "Guest requests should be accessible to reception");
  check(canRunAction("reception", "set_bed_configuration"), "Bed setup should be accessible to reception");
  check(!canRunAction("reception", "adjust_revenue_prices"), "Reception must not alter prices");
  check(!canRunAction("housekeeping", "adjust_revenue_prices"), "Housekeepers must not alter prices");
  check(canRunAction("top_management", "adjust_revenue_prices"), "Top management must be authorized");
  check(canRunAction("admin", "adjust_revenue_prices"), "Admin must be authorized");
});

Deno.test("room service validates the requested items and their quantity", () => {
  const good = validateAction("create_guest_request", {
    hotelId: "Hotel Memories Budapest", roomNumber: "202", requestType: "extra_towels", quantity: 3,
  });
  check(good.ok, "3 towels must be accepted");
  if (good.ok) {
    check(good.action.input.quantity === 3, "Quantity changed during validation");
    check(good.action.input.roomNumber === "202", "Room changed during validation");
  }
  check(!validateAction("create_guest_request", {
    hotelId: "hotel", roomNumber: "202", requestType: "extra_towels", quantity: 30,
  }).ok, "Unsafe quantity must be rejected");
  check(!validateAction("create_guest_request", {
    hotelId: "hotel", roomNumber: "", requestType: "other", quantity: 1,
  }).ok, "Room-less request must be rejected");
});

Deno.test("beds together maps to a supported canonical bed configuration", () => {
  const good = validateAction("set_bed_configuration", {
    hotelId: "hotel", roomNumber: "108", configuration: "Double Bed",
  });
  check(good.ok, "Double Bed should be supported");
  check(!validateAction("set_bed_configuration", {
    hotelId: "hotel", roomNumber: "108", configuration: "invented bed type",
  }).ok, "Unknown bed configuration must never be written");
});

Deno.test("relative rate adjustments must be bounded to authorized action", () => {
  const today = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (key: string) => today.find(p => p.type === key)?.value;
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const valid = validateAction("adjust_revenue_prices", {
    hotelId: "hotel", fromDate: day, toDate: day, deltaEur: -2,
  });
  check(valid.ok, "Small signed whole-euro adjustments should be permitted");
  check(!validateAction("adjust_revenue_prices", {
    hotelId: "hotel", fromDate: day, toDate: day, deltaEur: 0,
  }).ok, "Zero adjustment is not a write");
  check(!validateAction("adjust_revenue_prices", {
    hotelId: "hotel", fromDate: day, toDate: day, deltaEur: 0.5,
  }).ok, "Fractional euro rates are not accepted");
  check(!validateAction("adjust_revenue_prices", {
    hotelId: "hotel", fromDate: day, toDate: day, deltaEur: -100,
  }).ok, "Unsafe discount must be rejected");
  check(actionsForRole("reception").includes("create_guest_request"), "Action catalog has a role mismatch");
});
