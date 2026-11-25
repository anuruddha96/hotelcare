// Who may see the website booking engine settings, the embed code for the
// hotel's web team and the private test link. Mirrors the database rule
// public.booking_engine_can_manage (admins, top management, super admins).
export const TOP_MANAGEMENT_ROLES = ['admin', 'top_management', 'top_management_manager'] as const;

export function isTopManagement(role: string | null | undefined, superAdmin?: boolean | null): boolean {
  return Boolean(superAdmin) || (TOP_MANAGEMENT_ROLES as readonly string[]).includes(String(role ?? ''));
}

/** The private test link: guest page in test mode (nothing is saved). */
export function testLinkFor(origin: string, publicId: string, token: string, lang: string): string {
  return `${origin}/book/${publicId}?preview=${encodeURIComponent(token)}&lang=${encodeURIComponent(lang)}`;
}
