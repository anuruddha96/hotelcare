# Connect the three RD hotels, add a portfolio comparison view, and make pickup automation real

## What I verified first

- `hotel_configurations` already contains Memories Budapest, Mika Downtown, Gozsdu Court and Ottofiori under the same RD Hotels organization.
- `pms_configurations` only has rows for `ottofiori` (Previo 786631) and the test hotel. The three new hotels have **no PMS row**, so no housekeeping or revenue data can flow yet.
- Secrets contain only `PREVIO_CREDS_OTTOFIORI` for live Previo. Since Previo confirmed the same key covers all four properties, each hotel row will point at that same secret name and differ only by Previo hotel ID.
- The pickup automation rule for Ottofiori is saved and switched **on** (tiers +8 / +18 / +22, 60-minute window, +25 second pickup, min ADR 120, auto-publish on), but **no backend code reads `revenue_pickup_automation_rules`**. It is currently a saved preference with no engine behind it — no price has ever been changed by it.

## 1. Connect the three hotels to Previo

Add one `pms_configurations` row per hotel, mirroring the working Ottofiori row:

| Hotel | hotel_id | Previo ID |
|---|---|---|
| Hotel Memories Budapest | memories-budapest | 756545 |
| Hotel Mika Downtown | mika-downtown | 756541 |
| Gozsdu Court Budapest | gozsdu-court | 756543 |

Each row uses `credentials_secret_name = PREVIO_CREDS_OTTOFIORI` (shared key), live environment, sync enabled, manual sync mode first. I will rename nothing; if you prefer a neutral secret name later we can alias it.

Then, for each hotel in turn:
1. Run a connection probe to confirm the key authorises that hotel ID.
2. Pull rooms/room types, reservations and the daily overview → housekeeping starts working per property.
3. Pull rates, booking nights and snapshots → revenue calendar starts working per property.
4. Create the hotel's `hotel_revenue_settings` row (EUR base, sellable room count taken from the Previo pull, not guessed) and its Previo rate-plan mapping.

Every existing query already filters by `hotel_id`, so each hotel sees only its own data; the hotel switcher in the header selects between them. Ottofiori and SLNT behaviour is untouched.

If any hotel ID is rejected by Previo, I stop on that hotel, report the exact Previo error, and leave the other two connected rather than half-wiring everything.

## 2. Portfolio comparison view

A new "Portfolio" section on the Revenue overview page, visible to admins and top managers, limited to the hotels the user actually manages.

- **KPI summary per hotel** (cards in a row): occupancy, ADR, RevPAR, today's pickup, forecast revenue for the selected window, each with a same-period-last-year or prior-week delta where data exists.
- **Shared 90-day trend chart** below it, one line per hotel, colours fixed: Mika black, Memories light brown, Ottofiori green, Gozsdu bronze. Metric switch: Occupancy (default) / ADR / RevPAR / Pickup.
- **Booking curve tab**: cumulative on-the-books pace per hotel, so you can see which property is picking up ahead or behind.
- Data comes from the same live tables the single-hotel calendar uses, refreshed with the page, with a visible "last synced" stamp per hotel so nobody trusts stale numbers.

Two extras I would add because they turn the chart into a decision: a **portfolio gap list** (the 10 dates across all hotels with the weakest occupancy inside 30 days) and a **leader/laggard strip** naming which property is under-priced versus its own last-year ADR on the same date.

## 3. Make the pickup automation real, with guardrails

Build a `revenue-pickup-automation` engine that runs on a schedule (every 15 minutes) and on each revenue sync:

1. Detect new pickups since the last run, per hotel, per stay date (Budapest time).
2. Pick the tier by booking window from today to the stay date: ≤31 days +8, 32–93 days +18, >93 days +22.
3. If another pickup for the same stay date landed inside the 60-minute window, the next booking triggers the +25 second-pickup surcharge on all room types for that date.
4. Apply guardrails before anything is written:
   - never price below the 120 min ADR floor;
   - a per-day maximum change cap;
   - a daily change budget per hotel (max number of dates auto-changed per day);
   - only stay dates that actually had a pickup are touched.
5. Write the result with a distinct colour code in the rate calendar (automation-coloured cell, separate from your manual blue/orange dots), log every action in `revenue_pickup_automation_actions` with the triggering reservation, the tier used, the before/after price and the guardrail outcome.
6. Publish to Previo when auto-publish is on, then reconcile the landed price exactly like manual pushes do.
7. Every automated change can be manually overridden or undone from the cell, and an "undo this run" action reverts a whole batch.

### Plain-English rule explanation

In the automation sheet, above the inputs, a live sentence rewrites itself as you edit, e.g.:

> When a new booking arrives for a date within 1 month, raise every room type on that date by €8. Between 1 and 3 months, €18. Further out, €22. If a second booking for the same date arrives within 60 minutes, add another €25. Never let the price fall below €120. Changes are published to Previo automatically.

Plus a "what would this have done" preview: replays the last 7 days of real pickups against the current settings and shows how many dates would have moved and by how much, before you switch it on.

### Extra revenue levers to offer in the same sheet

- **Occupancy-triggered ladder**: raise more aggressively when the date is already above a chosen occupancy, less when it is soft.
- **Soft-date decay**: if a date inside 14 days is still under target occupancy, step the price down in small controlled amounts to a floor (your earlier −€2 idea, but bounded).
- **Day-of-week and event overrides**: weekends and known Budapest events get a multiplier.
- **Last-room-value**: bigger increase when only a few rooms remain on that date.
- **Blackout dates and a hard ceiling** so nothing runs away.

## Technical notes

- New tables/columns: automation run state and guardrail counters on `revenue_pickup_automation_rules`; `revenue_pickup_automation_actions` gains guardrail and undo fields. All with grants + RLS scoped by organization/hotel.
- Engine reuses the existing chunked, resumable push path (`revenue-push-drafts`) rather than a second write path, so Previo reconciliation stays authoritative.
- Scheduling via pg_cron, same pattern as the existing checkout poll job.
- Nothing in the SLNT tenant or its venue-scoped RLS is modified.

## Verification

- Confirm each new hotel authenticates against Previo and returns its own room and rate data.
- Confirm a top manager on one hotel cannot see another hotel's rows.
- Dry-run the automation engine in suggest mode against real recent pickups and compare against the rule sentence before enabling auto-publish.
