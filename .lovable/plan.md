# Restore live, date-column revenue automation for Ottofiori

## Goal
Keep Hotel Ottofiori automatic pricing live and revenue-producing. The engine will decide whether each stay-date column is eligible from the configured pricing rules, then move every mapped room type and occupancy in that column by one identical whole-EUR amount. Routine users will not see shadow-testing or technical safety-gate messages, while genuine delivery problems remain visible and actionable.

## Confirmed current state
- Ottofiori is enabled, but the live database currently has `mode = shadow` and `auto_publish = false`, with the pause reason “Publishing state was inconsistent and was reset safely before evaluation.”
- The latest run checked 218 dates, selected 9 eligible dates, and simulated 117 price cells, but queued and published zero because it ran in shadow mode.
- Engine V2 already makes its initial pricing decision once per stay date and computes one common movement across that date’s cells.
- The publisher subsequently rebuilds and repairs occupancy ladders per room type. That later repair can alter individual prices independently, so the final Previo payload is not yet guaranteed to preserve the date-wide movement.
- Earlier live runs successfully reached Previo: recent completed push runs show 24/24 and 89/89 prices accepted with no failures. The immediate blocker is automation state and end-to-end date integrity, not a general Previo outage.

## 1. Make the stay-date column the atomic pricing unit
- Evaluate pickup, occupancy pace, booking window, cancellations, ADR guard, seasonal anchor, events, competitors, manual holds, daily caps, floors, and ceilings once per stay date.
- Expand an eligible date into the complete set of mapped room-type and occupancy prices before queueing.
- Calculate one signed whole-EUR movement for the date. Reduce it to the maximum safe amount every cell can accept; if the remaining movement is below the configured minimum, hold the whole date.
- Include sold-out room types in the same date movement so a reopened room does not return at an inconsistent price.
- If any required mapping, price, or bound is missing, hold only that date and record the exact reason; continue processing other eligible dates.
- Persist a date-level manifest containing the requested movement and expected cells so retries cannot partially or repeatedly apply a date.

## 2. Preserve the date movement through Previo publishing
- For automation runs, make the validated date manifest authoritative. The publisher must not independently clamp, lift, or repair one occupancy after the date decision.
- Validate the complete occupancy ladders before queueing. If an existing ladder cannot be sent safely, hold the whole affected date instead of silently changing individual cells.
- Publish absolute target prices with idempotency, keeping all room types for a stay date together in the same durable run.
- Retry transient Previo, timeout, and queue-lock failures automatically. A failure for one date must not stop unrelated eligible dates or switch the entire property out of live mode.
- Reserve a property-wide pause for genuinely unsafe global conditions such as missing credentials, corrupt configuration, or stale source data beyond the allowed limit.

## 3. Keep Ottofiori live without another shadow gate
- Replace the current mixed-state normalization that resets `live + auto_publish=false` to shadow with one atomic operational state transition.
- After a clean preflight, set Ottofiori to live with automatic publishing enabled, clear the stale pause reason, and retain the hourly schedule.
- Do not restart the 24-hour/12-run shadow activation gate for recoverable date-level validation or delivery errors.
- Scope the production activation and any Ottofiori-specific defaults to `hotel_id = ottofiori`; do not change another property’s automation state or rules.

## 4. Make status useful without exposing technical test messages
- Remove the large “shadow test mode” banner and safety-review countdown from the normal revenue screen.
- Show a compact operational status: Live, last successful evaluation, last confirmed Previo delivery, next run, and number of dates needing attention.
- Keep the activity center as the audit trail, but describe results by stay dates first: eligible, changed, held, accepted, confirmed, and failed.
- For each changed date, show the single applied movement and that all included prices moved together.
- Surface persistent failures with the affected dates and a plain-language cause. Do not show noisy routine success toasts or raw technical errors.

## 5. Correct outcome tracking
- Leave date decisions `queued` until the publisher accepts them; mark them `confirmed` only after Previo read-back matches.
- Update each date from its own push items rather than assigning one aggregate status to every date in the run.
- Ensure failed or mismatched cells identify and mark their date, while successfully delivered dates remain successful.
- Track run totals from actual accepted, confirmed, different, and failed outcomes so the activity center never reports queued work as live revenue.

## 6. Validate and release
- Add regression coverage for date eligibility, identical movement across every room type/occupancy, headroom reduction, sold-out rooms, missing mappings, legacy out-of-bound prices moving only in the safe direction, retries, and per-date publisher outcomes.
- Replay representative recent Ottofiori inputs and assert that every changed date has exactly one delta across all expected cells.
- Deploy the automation and publisher together, run a non-publishing preflight, then atomically activate Ottofiori live and trigger one production run.
- Verify database run linkage, complete date manifests, Previo acceptance/read-back, and the next scheduled run. If a date fails, verify that only that date is held and the property remains live.

## Technical changes
- Update Engine V2’s date expansion and safety validation to emit an authoritative date manifest.
- Update the durable push run/items and publisher grouping so automation cannot mutate or partially deliver a date after queueing.
- Update automation run/date outcome propagation to use per-date push results.
- Simplify the revenue status banner and activity details around live operation and actionable failures.
- Apply any required schema changes through a migration with explicit grants, RLS, and existing hotel/organization isolation.
