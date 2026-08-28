/**
 * Per-browser-tab property selection.
 *
 * `profiles.assigned_hotel` is a single global value, so switching property in
 * one tab used to drag every other tab to the same property on its next load.
 * sessionStorage is scoped to one tab, so a manager can keep one window open
 * per property.
 *
 * The first profile load pins the account default into this tab. Later profile
 * refreshes cannot move an already-open tab when another window changes the
 * account default.
 */

const KEY_PREFIX = "hotelcare.tabHotel";

function keyFor(organizationSlug: string): string {
  return `${KEY_PREFIX}:${organizationSlug.trim().toLowerCase()}`;
}

export function getTabHotel(organizationSlug: string): string | null {
  try {
    return sessionStorage.getItem(keyFor(organizationSlug));
  } catch {
    return null;
  }
}

export function setTabHotel(organizationSlug: string, hotelId: string | null): void {
  try {
    const key = keyFor(organizationSlug);
    if (hotelId) sessionStorage.setItem(key, hotelId);
    else sessionStorage.removeItem(key);
  } catch {
    /* private mode — fall back to the account default */
  }
}

/** Apply this tab's property choice to a freshly loaded profile row. */
export function withTabHotel<T extends { assigned_hotel?: string | null; organization_slug?: string | null }>(profile: T): T {
  if (!profile.organization_slug) return profile;
  let tabHotel = getTabHotel(profile.organization_slug);
  if (!tabHotel && profile?.assigned_hotel) {
    setTabHotel(profile.organization_slug, profile.assigned_hotel);
    tabHotel = profile.assigned_hotel;
  }
  if (!tabHotel) return profile;
  return { ...profile, assigned_hotel: tabHotel };
}

export function clearTabHotels(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key === KEY_PREFIX || key?.startsWith(`${KEY_PREFIX}:`)) sessionStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
}
