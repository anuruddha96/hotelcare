/**
 * Per-browser-tab property selection. This is presentation state only, never
 * evidence of hotel authorization: every data read/write needs backend RLS.
 *
 * The account default lives in profiles.assigned_hotel. Tab-specific choices
 * allow an authorized manager to keep separate hotels open in separate tabs.
 * Temporary staff duty is rehydrated ONLY after current_property_duty verifies
 * the signed-in caller and an unexpired server-side grant.
 */
const KEY_PREFIX = 'hotelcare.tabHotel';
const LEGACY_MANAGER_ROLES = [
  'admin', 'manager', 'housekeeping_manager', 'top_management', 'top_management_manager',
];

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
 * Pin legacy manager selection to both organization and authenticated user.
 * A staff member (especially a housekeeper) must never regain a different
 * venue merely by editing sessionStorage or reusing a previous login's tab.
 */
export function withTabHotel<T extends {
  id?: string; role?: string; assigned_hotel?: string | null; organization_slug?: string | null;
}>(profile: T): T {
  if (!profile.organization_slug || !profile.id) return profile;

  try {
    const ownerKey = ownerKeyFor(profile.organization_slug);
    if (sessionStorage.getItem(ownerKey) !== profile.id) {
      sessionStorage.removeItem(keyFor(profile.organization_slug));
      sessionStorage.setItem(ownerKey, profile.id);
    }
  } catch {
    return profile;
  }

  // Non-managers only change their visible hotel after an authenticated duty
  // RPC succeeds; their cached tab selection is not an access token.
  if (!profile.role || !LEGACY_MANAGER_ROLES.includes(profile.role)) {
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
