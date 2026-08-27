// Who may open the Hotel Care Assistant.
//
// Rollout is complete: every working role gets the copilot, because what it can
// actually read or change is decided server-side from the signed-in profile
// (organization, property and role scopes). Roles with no operational data area
// — and anyone signed out — still do not see the button.

const PILOT_EMAILS = ["anu@rdhotels.hu"];

/** Roles with at least one assistant data scope. Mirrors the edge function. */
const ASSISTANT_ROLES = [
  "admin",
  "manager",
  "top_management",
  "top_management_manager",
  "housekeeping",
  "housekeeping_manager",
  "supervisor",
  "maintenance",
  "maintenance_manager",
  "reception",
  "reception_manager",
  "front_office",
  "breakfast_staff",
  "control_finance",
  "control_manager",
  "finance_manager",
  "back_office_manager",
];

export function canUseAssistant(profile: {
  role?: string | null;
  email?: string | null;
} | null | undefined): boolean {
  if (!profile) return false;
  if (profile.role && ASSISTANT_ROLES.includes(profile.role)) return true;
  const email = (profile.email ?? "").trim().toLowerCase();
  return PILOT_EMAILS.includes(email);
}
