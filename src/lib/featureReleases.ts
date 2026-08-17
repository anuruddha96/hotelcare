// Newly released features, and the day they went live.
//
// A "New" badge shows next to a feature for NEW_BADGE_DAYS days from its
// release date, or until the person opens it once — whichever comes first.
// Opening is remembered in `profiles.ui_preferences`, so it follows the user
// to every device.

export const NEW_BADGE_DAYS = 5;

export interface FeatureRelease {
  key: string;
  releasedOn: string; // YYYY-MM-DD
}

export const FEATURE_RELEASES: FeatureRelease[] = [
  { key: "revenue.segments", releasedOn: "2026-08-17" },
  { key: "revenue.yoy", releasedOn: "2026-08-17" },
  { key: "revenue.compset", releasedOn: "2026-08-17" },
  { key: "revenue.digest", releasedOn: "2026-08-17" },
];

/** True while the release is still inside its badge window. */
export function isWithinBadgeWindow(key: string, now = new Date()): boolean {
  const rel = FEATURE_RELEASES.find((f) => f.key === key);
  if (!rel) return false;
  const released = new Date(`${rel.releasedOn}T00:00:00Z`).getTime();
  const ageDays = (now.getTime() - released) / 86_400_000;
  return ageDays >= 0 && ageDays < NEW_BADGE_DAYS;
}

export const SEEN_FEATURES_PREF_KEY = "seenFeatures";
