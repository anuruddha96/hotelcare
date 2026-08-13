/**
 * Per-browser-tab property selection.
 *
 * `profiles.assigned_hotel` is a single global value, so switching property in
 * one tab used to drag every other tab to the same property on its next load.
 * sessionStorage is scoped to one tab, so a manager can keep one window open
 * per property.
 *
 * A tab only gets an override once the user switches property inside that tab;
 * untouched tabs keep the account default.
 */

const KEY = "hotelcare.tabHotel";

export function getTabHotel(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setTabHotel(hotelId: string | null): void {
  try {
    if (hotelId) sessionStorage.setItem(KEY, hotelId);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode — fall back to the account default */
  }
}

/** Apply this tab's property choice to a freshly loaded profile row. */
export function withTabHotel<T extends { assigned_hotel?: string | null }>(profile: T): T {
  const tabHotel = getTabHotel();
  if (!tabHotel || !profile) return profile;
  return { ...profile, assigned_hotel: tabHotel };
}
