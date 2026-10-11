/** Client-side audience and expiry guard for announcement surfaces.
 * The system's admin management permission intentionally grants a broader
 * database read, so end-user banners must apply the announcement's targets. */
export interface AudienceAnnouncement {
  published: boolean;
  starts_at: string;
  ends_at: string | null;
  target_org_slugs: string[];
  target_roles: string[];
}
export interface AudienceProfile {
  role: string;
  organization_slug?: string | null;
}
export function isAnnouncementVisible(
  a: AudienceAnnouncement,
  profile: AudienceProfile | null | undefined,
  at = Date.now(),
): boolean {
  if (!profile || !a.published) return false;
  const start = Date.parse(a.starts_at);
  if (!Number.isFinite(start) || start > at) return false;
  if (a.ends_at) {
    const end = Date.parse(a.ends_at);
    if (!Number.isFinite(end) || end <= at) return false;
  }
  if (a.target_roles?.length && !a.target_roles.includes(String(profile.role))) return false;
  if (a.target_org_slugs?.length && !a.target_org_slugs.includes(profile.organization_slug ?? '')) return false;
  return true;
}
