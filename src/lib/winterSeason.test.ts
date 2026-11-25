import { describe, expect, it } from "vitest";
import { canSeeWinterSnow, isWinterSeason, WINTER_START, WINTER_END } from "./winterSeason";

describe("2026 winter workspace", () => {
  it("uses Budapest midnight and does not recur next year", () => {
    expect(isWinterSeason(WINTER_START - 1)).toBe(false);
    expect(isWinterSeason(WINTER_START)).toBe(true);
    expect(isWinterSeason(Date.parse("2026-12-31T22:59:59.999Z"))).toBe(true);
    expect(isWinterSeason(WINTER_END)).toBe(false);
    expect(WINTER_END).toBe(Date.parse("2026-12-31T23:00:00Z"));
    expect(isWinterSeason(Date.parse("2027-12-25T12:00:00Z"))).toBe(false);
  });

  it.each(["admin", "top_management", "top_management_manager", "manager", "housekeeping_manager", "reception_manager", "maintenance_manager", "hr", "control_finance", "back_office_manager"])("allows managers: %s", (role) => {
    expect(canSeeWinterSnow({ role })).toBe(true);
  });

  it.each(["housekeeping", "maintenance", "reception", "front_office", "supervisor", "breakfast_staff", "marketing", "unknown"])("excludes non-managers: %s", (role) => {
    expect(canSeeWinterSnow({ role })).toBe(false);
  });

  it("uses the effective job role rather than shared manager permission", () => {
    expect(canSeeWinterSnow({ role: "manager", access_role: "housekeeping_manager" })).toBe(true);
    expect(canSeeWinterSnow({ role: "manager", access_role: "housekeeping_supervisor" })).toBe(false);
    expect(canSeeWinterSnow({ role: "manager", access_role: "reception" })).toBe(false);
    expect(canSeeWinterSnow(null)).toBe(false);
    expect(canSeeWinterSnow({ role: "other", is_super_admin: true })).toBe(true);
  });
});
