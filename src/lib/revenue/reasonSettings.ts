// Public reason-setting entry point. Keep the established reason catalogue in
// reasonSettingsCore.ts and add the near-arrival sell-out policies here so the
// activity feed explains the decision the manager is actually seeing.

export * from "./reasonSettingsCore";

import {
  REASON_SETTINGS as CORE_REASON_SETTINGS,
  type ReasonInfo,
} from "./reasonSettingsCore";

export const REASON_SETTINGS: Record<string, ReasonInfo> = {
  ...CORE_REASON_SETTINGS,

  same_day_sellout: {
    title: "Arrival today — sell-out markdown",
    explain:
      "Rooms are still unsold for today and no genuine booking arrived during the latest 30-minute observation window, so HotelCare lowered the rate. The markdown becomes more urgent as 15:00 approaches.",
    settings: [],
    note:
      "Ottofiori checks the current stay date every 30 minutes. Automatic same-day markdowns stop at the authorised €100 floor or at 15:00, whichever happens first.",
  },
  same_day_recent_pickup: {
    title: "Arrival today — recent pickup, price held",
    explain:
      "A genuine booking arrived during the current 30-minute observation window, which is evidence that the current price is selling. HotelCare holds this cycle and checks again 30 minutes later.",
    settings: [],
  },
  same_day_wait_next_check: {
    title: "Arrival today — waiting for next check",
    explain:
      "Today's rate was evaluated very recently, so HotelCare is waiting for the next 30-minute sell-out checkpoint instead of changing the rate twice in quick succession.",
    settings: [],
  },
  same_day_cutoff: {
    title: "Arrival today — automatic window closed",
    explain:
      "The local time is 15:00 or later, so automatic same-day sell-out pricing has stopped and the remaining inventory is left for management to handle.",
    settings: [],
  },
  same_day_floor_reached: {
    title: "Arrival today — minimum rate reached",
    explain:
      "HotelCare has reached the authorised same-day minimum rate and will not reduce today's price automatically again. Top management should take over manually if a lower rate is desired.",
    settings: [],
    note: "The dedicated same-day sell-out policy for Ottofiori is authorised down to €100.",
  },

  final_3_day_fill: {
    title: "Tomorrow / day +2 — selling the last rooms",
    explain:
      "Arrival is one or two days away and rooms are still unsold, so reaching 100% occupancy takes priority. Recent pickup can make the markdown smaller, but it will not raise the price while rooms remain.",
    settings: [],
    note:
      "Safety still applies: manual locks, the short cancellation wait, the absolute room-rate floor, recent-peak markdown depth and the final-window daily decrease allowance.",
  },
};
