import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFrontOfficeManager, miraUsagePolicyFor } from "./miraUsagePolicy.ts";

const tier = (subject: Record<string, unknown>, unlimitedOverride = false) =>
  miraUsagePolicyFor(subject as any, { unlimitedOverride }).tier;

Deno.test("housekeepers, maintenance and breakfast staff get no Mira", () => {
  assertEquals(tier({ role: "housekeeping" }), "none");
  assertEquals(tier({ role: "maintenance" }), "none");
  assertEquals(tier({ role: "maintenance_manager" }), "none");
  assertEquals(tier({ role: "breakfast_staff" }), "none");
  // A housekeeper never gets Mira, even on the unlimited list.
  assertEquals(tier({ role: "housekeeping" }, true), "none");
});

Deno.test("managers, housekeeping managers, top management, controlling, HR and admins have no monthly limit", () => {
  for (const subject of [
    { role: "admin" },
    { role: "manager" },
    { role: "manager", access_role: "manager" },
    { role: "manager", access_role: "housekeeping_manager" },
    { role: "housekeeping_manager" },
    { role: "top_management_manager" },
    { role: "top_management_manager", access_role: "controlling" },
    { role: "hr" },
    { role: "marketing", is_super_admin: true },
  ]) {
    const policy = miraUsagePolicyFor(subject as any);
    assertEquals(policy.tier, "leadership", JSON.stringify(subject));
    assertEquals(policy.monthlyLimit, null);
    assertEquals(policy.dailyLimit, 300);
  }
});

Deno.test("front office managers are leadership; receptionists and supervisors get the higher standard limit", () => {
  assertEquals(isFrontOfficeManager({ role: "manager", access_role: "reception" }), true);
  assertEquals(isFrontOfficeManager({ role: "reception_manager" }), true);
  assertEquals(tier({ role: "manager", access_role: "reception" }), "leadership");
  assertEquals(tier({ role: "reception" }), "standard");
  assertEquals(tier({ role: "front_office" }), "standard");
  assertEquals(tier({ role: "manager", access_role: "housekeeping_supervisor" }), "standard");
  assertEquals(tier({ role: "supervisor" }), "standard");
  const standard = miraUsagePolicyFor({ role: "reception" });
  assertEquals(standard.monthlyLimit, 300);
  assertEquals(standard.dailyLimit, 60);
});

Deno.test("the unlimited list lifts a standard user to leadership", () => {
  assertEquals(tier({ role: "reception" }, true), "leadership");
});
