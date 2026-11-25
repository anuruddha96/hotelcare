# Manual minimum-stay priority (HotelCare / Previo)

Owner requirement — 12 November 2026: when an authorized manager manually changes a previously automated minimum stay (MinLOS), the human choice takes precedence. No scheduled worker should silently restore the earlier automated minimum, including during a normal sync.

## Deployed worker behavior (proposed)

- A HotelCare restriction push persists the acting user's ID in `min_stay_rules.updated_by`. The minimum-stay automation must read that provenance and **hold** the human-selected value on that date, without a time expiry.
- AI and rules may still evaluate demand but must not automatically change a human-protected MinLOS. Even unusually strong demand is never a certainty of conversion. A possible exception is a **manager-visible recommendation**, never a silent write, and may propose **at most a 2-night minimum**. The manager retains the final choice.
- To avoid optimistic-update races, the automation rereads each planned batch's current MinLOS, `updated_by`, and `updated_at` immediately before any Previo write. On conflict it defers the entire batch; a subsequent run can safely re-evaluate the remaining unprotected dates.
- The automated rule already configured at each participating hotel remains capped at two nights. No prices, bookings, inventory, room availability, or rate plans are changed by this feature.
- Suggestions require exceptional property-level demand: at least 95% occupancy, no more than two rooms left and at least two distinct 24-hour pickup bookings, plus the existing revenue algorithm's evidence for a two-night restriction. Suggestion alerts are deduplicated by date/proposed target for 24 hours. If weaker evidence exists, simply hold the human choice.

## Verification scenarios

1. Automation sets 2 nights; manager subsequently sets 1 night in HotelCare: subsequent hourly runs retain 1 and log `manual_override_hold`.
2. Manager sets 2 nights after automation proposed 1 night: subsequent runs retain 2 even if algorithm recommends releasing it.
3. One manually protected day between two automatable days: the date grouping must not write across the protected day.
4. Manager edits a date between evaluation and publication: prewrite baseline check prevents publishing that date's stale group.
5. Low-demand human-protected date: do not alert repeatedly; no Previo write.
6. Exceptional, verified demand on a human-protected 1-night date: propose 2 nights as a manager-review notification, but **do not apply** automatically; deduplicate notifications for 24 hours.
7. Unprotected dates continue using existing 1/2-night algorithm and cooldowns.

## Remaining integration boundary

A change made **directly inside Previo** does not necessarily carry a HotelCare `updated_by` marker. A future bidirectional restrictions-import / external-change provenance check should be added to guarantee the same protection for out-of-app edits. Until implemented, the worker can only establish this protection reliably for edits attributed to a HotelCare user, and must not claim Previo-only changes are captured.

## Manual release

A future UI action to explicitly *Resume automation for this date* should clear the override in an auditable and authorized way; simply waiting for the hourly worker must not release it.
