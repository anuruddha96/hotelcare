/**
 * Per-browser-tab property selection. This is presentation state only, never
 * evidence of hotel authorization: every data read/write needs backend RLS.
 *
 * The account default lives in profiles.assigned_hotel. Tab-specific choices
 * allow an authorized manager to keep separate hotels open in separate tabs.
 */
const KEY_PREFIX = 'hotelcare.tabHotel';

function keyFor(organizationSlug: string): string {
  return `${KEY_PREFIX}:${organizationSlug.trim().toLowerCase()}`;
}

function ownerKeyFor(organizationSlug: string): string {
  return `${KEY_PREFIX}:owner:${organizationSlug.trim().toLowerCase()}`;
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

/**
 * Pin the selection to both an organization AND its authenticated user.
 * Browser tabs can survive a logout/login; never inherit another employee's
 * selected hotel, even when both employees belong to the same organization.
 */
export function withTabHotel<T extends { id?: string; assigned_hotel?: string | null; organization_slug?: string | null }>(profile: T): T {
  if (!profile.organization_slug || !profile.id) return profile;

  try {
    const ownerKey = ownerKeyFor(profile.organization_slug);
    if (sessionStorage.getItem(ownerKey) !== profile.id) {
      sessionStorage.removeItem(keyFor(profile.organization_slug));
      sessionStorage.setItem(ownerKey, profile.id);
    }
  } catch {
    // Without storage we must not apply an unverified previous account's tab.
    return profile;
  }

  let tabHotel = getTabHotel(profile.organization_slug);
  if (!tabHotel && profile.assigned_hotel) {
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
