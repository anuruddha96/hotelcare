// Public reason-setting entry point. Keep the established reason catalogue in
// reasonSettingsCore.ts and add the final-three-day sell-out policy here so the
// notification UI explains the new behaviour in plain language.

export * from "./reasonSettingsCore";

import {
  REASON_SETTINGS as CORE_REASON_SETTINGS,
  type ReasonInfo,
} from "./reasonSettingsCore";

export const REASON_SETTINGS: Record<string, ReasonInfo> = {
  ...CORE_REASON_SETTINGS,
  final_3_day_fill: {
    title: "Final 3 days — selling the last rooms",
    explain:
      "Arrival is within three days and rooms are still unsold, so reaching 100% occupancy takes priority. Recent pickup can make the markdown smaller, but it will not raise the price while rooms remain.",
    settings: [],
    note:
      "Safety still applies: manual locks, the short cancellation wait, the absolute room-rate floor, recent-peak markdown depth and the final-window daily decrease allowance.",
  },
};
