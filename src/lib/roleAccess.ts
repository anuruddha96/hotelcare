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
