import { effectiveAccessRole, type AccessSubject } from "@/lib/accessPolicy";

const WEATHER_ROLES = new Set(["admin", "top_management", "controlling", "hr", "manager", "housekeeping_manager", "housekeeping_supervisor", "reception"]);
const LEGACY_OFFICE_ROLES = new Set(["marketing", "marketing_manager", "back_office_manager"]);

/** Use the actual job role, not a shared manager permission level. */
export function canSeeWorkspaceWeather(profile: AccessSubject): boolean {
  if (!profile) return false;
  const role = effectiveAccessRole(profile);
  // Back-office and marketing have no distinct effective access role today.
  // This display-only exception must not change the shared permissions policy.
  return profile.is_super_admin === true || WEATHER_ROLES.has(role)
    || (role === "maintenance" && profile.role === "maintenance_manager")
    || (role === "other" && LEGACY_OFFICE_ROLES.has(profile.role ?? ""));
}

export type WorkspaceLocation = { label: string; latitude: number; longitude: number; timeZone: string };

export function workspaceLocation(org: string | null | undefined, settings: unknown): WorkspaceLocation | null {
  const config = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const location = config.weather_location;
  if (location && typeof location === "object") {
    const { label, latitude, longitude, timeZone } = location as Partial<WorkspaceLocation>;
    if (typeof label === "string" && label.trim() && typeof latitude === "number" && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
        typeof longitude === "number" && Number.isFinite(longitude) && Math.abs(longitude) <= 180 && typeof timeZone === "string") {
      try {
        new Intl.DateTimeFormat("en", { timeZone });
        return { label, latitude, longitude, timeZone };
      } catch { /* Invalid configuration: fall back only for known Budapest properties. */ }
    }
  }
  // RD Hotels properties are in Budapest. Use city coordinates, never staff GPS.
  return org === "rdhotels" ? { label: "Budapest", latitude: 47.4979, longitude: 19.0402, timeZone: "Europe/Budapest" } : null;
}

export function workspaceWeatherKind(symbol: string): "sun" | "cloud" | "rain" | "snow" | "storm" {
  if (symbol.includes("thunder")) return "storm";
  if (symbol.includes("snow") || symbol.includes("sleet")) return "snow";
  if (symbol.includes("rain")) return "rain";
  if (symbol.startsWith("clearsky") || symbol.startsWith("fair")) return "sun";
  return "cloud";
}
