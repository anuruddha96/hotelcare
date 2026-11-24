import { describe, expect, it } from "vitest";
import { canSeeWorkspaceWeather, workspaceLocation, workspaceWeatherKind } from "./workspaceAppearance";

describe("manager workspace conditions", () => {
  it("shows the panel for housekeeping managers and higher actual roles", () => {
    for (const role of ["housekeeping_manager", "manager", "admin", "top_management", "top_management_manager", "hr", "control_finance"]) {
      expect(canSeeWorkspaceWeather({ role })).toBe(true);
    }
    expect(canSeeWorkspaceWeather({ role: "manager", access_role: "housekeeping_manager" })).toBe(true);
    expect(canSeeWorkspaceWeather({ role: "top_management_manager", access_role: "hr" })).toBe(true);
  });
  it("does not expose it to staff with a shared manager permission", () => {
    for (const access_role of ["reception", "housekeeping_supervisor", "other"]) {
      expect(canSeeWorkspaceWeather({ role: "manager", access_role })).toBe(false);
    }
    for (const role of ["housekeeping", "maintenance", "reception", "supervisor", "breakfast_staff"]) {
      expect(canSeeWorkspaceWeather({ role })).toBe(false);
    }
    expect(canSeeWorkspaceWeather(null)).toBe(false);
  });
  it("uses Budapest time and city coordinates for RD Hotels only", () => {
    expect(workspaceLocation("rdhotels", null)).toMatchObject({ label: "Budapest", timeZone: "Europe/Budapest" });
    expect(workspaceLocation("another-org", null)).toBeNull();
    expect(workspaceLocation("another-org", { weather_location: { label: "Vienna", latitude: 48.2, longitude: 16.3, timeZone: "Europe/Vienna" } })).toMatchObject({ label: "Vienna" });
    expect(workspaceLocation("another-org", { weather_location: { label: "Invalid", latitude: 300, longitude: 16, timeZone: "Europe/Vienna" } })).toBeNull();
  });
  it("maps forecast conditions with storm precedence", () => {
    expect(workspaceWeatherKind("lightrainandthunder")).toBe("storm");
    expect(workspaceWeatherKind("lightsnow")).toBe("snow");
    expect(workspaceWeatherKind("rain")).toBe("rain");
    expect(workspaceWeatherKind("clearsky_night")).toBe("sun");
    expect(workspaceWeatherKind("cloudy")).toBe("cloud");
  });
});
