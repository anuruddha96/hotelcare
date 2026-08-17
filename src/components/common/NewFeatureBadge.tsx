// A small "New" marker for freshly released features.
//
// It disappears five days after the release date, or as soon as the person
// opens the feature once — whichever happens first. The "opened" list lives in
// the profile, so hiding it on the phone also hides it on the desktop.

import { useCallback } from "react";
import { useUiPreference } from "@/hooks/useUiPreference";
import { isWithinBadgeWindow, SEEN_FEATURES_PREF_KEY } from "@/lib/featureReleases";
import { cn } from "@/lib/utils";

export function useFeatureSeen() {
  const { value, setValue, ready } = useUiPreference<string[]>(SEEN_FEATURES_PREF_KEY, []);
  const seen = Array.isArray(value) ? value : [];

  const markSeen = useCallback(
    (key: string) => {
      if (seen.includes(key)) return;
      setValue([...seen, key]);
    },
    [seen, setValue],
  );

  const isNew = useCallback(
    (key: string) => ready && isWithinBadgeWindow(key) && !seen.includes(key),
    [ready, seen],
  );

  return { isNew, markSeen };
}

export function NewFeatureBadge({ show, className }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span
      className={cn(
        "ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-primary-foreground",
        className,
      )}
    >
      New
    </span>
  );
}
