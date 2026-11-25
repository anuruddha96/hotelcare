/** Mirrors MAIL_ROLES in supabase/functions/_shared/mailFormat.ts (the server decides). */
export const ASSISTANT_MAIL_ROLES = [
  "admin",
  "top_management",
  "top_management_manager",
  "manager",
  "reception_manager",
  "back_office_manager",
  "housekeeping_manager",
  "maintenance_manager",
];

export function canConnectMailbox(role: string | null | undefined): boolean {
  return ASSISTANT_MAIL_ROLES.includes(role ?? "");
}
