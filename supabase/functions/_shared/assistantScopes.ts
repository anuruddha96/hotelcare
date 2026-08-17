// Role -> data scopes for the Hotel Care Assistant.
// This is the single source of truth. The edge function only exposes the tools
// that belong to the caller's scopes, so the model cannot be talked into
// reading data the user may not see.

export type AssistantScope = "revenue" | "housekeeping" | "maintenance" | "reception";

export const ALL_SCOPES: AssistantScope[] = ["revenue", "housekeeping", "maintenance", "reception"];

const ROLE_SCOPES: Record<string, AssistantScope[]> = {
  admin: ALL_SCOPES,
  top_management: ALL_SCOPES,
  top_management_manager: ALL_SCOPES,
  manager: ALL_SCOPES,
  back_office_manager: ["housekeeping", "maintenance", "reception"],

  housekeeping: ["housekeeping"],
  housekeeping_manager: ["housekeeping", "maintenance"],
  supervisor: ["housekeeping"],

  maintenance: ["maintenance"],
  maintenance_manager: ["maintenance", "housekeeping"],

  reception: ["reception"],
  front_office: ["reception"],
  reception_manager: ["reception", "housekeeping"],

  breakfast_staff: ["reception"],
  control_finance: [],
  control_manager: [],
  finance_manager: [],
  hr: [],
  marketing: [],
  marketing_manager: [],
  back_office: [],
};

export function scopesForRole(role: string | null | undefined): AssistantScope[] {
  if (!role) return [];
  return ROLE_SCOPES[role] ?? [];
}

/** Only the admin may look across organizations. */
export function canSeeAllOrganizations(role: string | null | undefined): boolean {
  return role === "admin";
}

export const SCOPE_LABEL: Record<AssistantScope, string> = {
  revenue: "Revenue management",
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  reception: "Reception & front office",
};
