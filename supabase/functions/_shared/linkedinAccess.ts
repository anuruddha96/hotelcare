/** Shared navigation and API role gate; the API additionally pins the pilot to its authenticated UUID. */
export type LinkedInProfile = { id?: string | null; role?: string | null; access_role?: string | null; nickname?: string | null; organization_slug?: string | null };
export function canAccessLinkedIn(profile: LinkedInProfile | null | undefined, slug: string | null | undefined): boolean {
  if (!profile || !slug || profile.organization_slug !== slug) return false;
  return (profile.role === "admin" && (!profile.access_role || profile.access_role === "admin"))
    || (slug === "rdhotels" && profile.nickname?.trim().toLowerCase() === "anu_000");
}
export function canAccessLinkedInServer(profile: LinkedInProfile | null | undefined, slug: string, authenticatedId: string, pilotId?: string): boolean {
  if (!profile || profile.id !== authenticatedId || !canAccessLinkedIn(profile, slug)) return false;
  if (profile.role === "admin" && (!profile.access_role || profile.access_role === "admin")) return true;
  return !!pilotId && pilotId === authenticatedId;
}
