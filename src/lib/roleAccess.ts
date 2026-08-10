// Centralized role-access helpers.
//
// Reception / front-office staff currently have a single primary task in
// the app: uploading the nightly Previo Daily Overview XLSX so the /bb
// breakfast lookup works the next morning. Everything else they can see
// is read-only until explicitly expanded.

export const RECEPTION_ROLES = ["reception", "front_office"] as const;

export type ReceptionRole = (typeof RECEPTION_ROLES)[number];

export function isReceptionRole(role: string | null | undefined): boolean {
  return !!role && (RECEPTION_ROLES as readonly string[]).includes(role);
}

/** Roles that should see the app in read-only mode (no create/edit/delete). */
export function isReadOnlyRole(role: string | null | undefined): boolean {
  return isReceptionRole(role);
}

/* ------------------------------------------------------------------ */
/* Manager / revenue powers                                            */
/* ------------------------------------------------------------------ */

/** Executive roles: manager powers everywhere + the Revenue module. */
export const EXECUTIVE_ROLES = ["top_management", "top_management_manager"] as const;

/** Roles with full manager powers in Housekeeping (write access). */
export const MANAGER_POWER_ROLES = [
  "admin",
  "top_management",
  "top_management_manager",
  "manager",
  "housekeeping_manager",
] as const;

export function isExecutiveRole(role: string | null | undefined): boolean {
  return !!role && (EXECUTIVE_ROLES as readonly string[]).includes(role);
}

/** Top management gets the same operational powers as a manager. */
export function hasManagerPowers(role: string | null | undefined): boolean {
  return !!role && (MANAGER_POWER_ROLES as readonly string[]).includes(role);
}

/** Who may open the Revenue Management module at all. */
export function canSeeRevenue(role: string | null | undefined): boolean {
  return role === "admin" || isExecutiveRole(role);
}

/**
 * Revenue "admin" surfaces (Strategy Calendar, Events, Analyst, Pricing
 * Strategy, Sync history, Push/Autopilot). Top management gets exactly the
 * same revenue powers as an admin — the edge functions already allow it.
 */
export function isRevenueAdmin(role: string | null | undefined): boolean {
  return role === "admin" || isExecutiveRole(role);
}

