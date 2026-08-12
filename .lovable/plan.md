# Fast, invisible Previo publishing and smarter property automation

## Goal
Make a Hotel Care price edit feel immediate: the calendar updates at once, Previo publishing continues server-side, verification never blocks the user, and only a genuine rejection or mismatch appears as a red warning. Extend the same reliable publisher with per-property positive-pickup and no-pickup rules.

## Confirmed current state
- Manual and bulk edits are first saved as rows in `revenue_rate_drafts`, then the browser waits for synchronous `revenue-push-drafts` calls in chunks of 1,000. The browser shows progress, waiting, and confirmation states while those calls finish.
- The push function already collapses consecutive dates with identical occupancy prices into Previo `DateRange` writes, but still sends one Previo message per resulting room-type/rate-plan range and waits for all messages before responding. This is why varied long-range changes remain slow.
- Previo requires a complete, gap-free occupancy ladder in each affected room type; the new flow must preserve that protection.
- Ottofiori currently has an enabled, auto-publishing rule applying to **all room types**, with first-pickup increases of **€8 / €18 / €22**, a **€25** repeat-pickup amount, a **€40 daily increase cap**, and **€120 minimum ADR**.
- The deployed pickup job runs every 15 minutes. The current code now rejects stale bookings and dates whose 48-hour net pickup is not positive, but it has no configurable no-pickup markdown schedule.
- Other legacy revenue jobs create recommendations; Ottofiori has `auto_apply` off there. The pickup automation function is the current direct Previo publisher.

## 1. Replace browser-held pushes with a durable server-side run
- Add hotel- and organization-scoped push-run and push-item records with explicit grants and RLS using the existing revenue-user and hotel-access checks.
- Treat every manual edit as a publish request, not a user-visible draft. Create the run, record its items, and optimistically mirror the requested prices into Hotel Care in one server transaction.
- Trigger a background worker immediately after enqueueing. Add a scheduled recovery tick so queued or interrupted runs resume even if the tab closes or an Edge Function instance stops.
- Make processing idempotent with a stable run/item key, claim timestamps, bounded retries, and stale-claim recovery. A retry must never apply a relative increase twice; every Previo message sends an absolute target price.
- Keep accepted, confirmed, different, and failed states internally for auditability, but remove them from the normal editing workflow.

## 2. Make long-range publishing efficient
- Move all expansion and grouping to the server. Bulk edits submit a compact operation (date range, weekdays, room types, occupancies, adjustment mode/value, floor/ceiling) rather than making the browser save and resend thousands of individual draft IDs.
- Resolve authoritative current prices server-side, build complete occupancy ladders, and collapse adjacent dates with identical ladders before calling Previo.
- Partition work by Previo account, rate plan, room type, currency, and final ladder. Process a conservative configurable number of independent messages concurrently, with timeout retry and exponential backoff.
- Run a safe capability test against the Previo EQC format before attempting multi-room XML messages. If Previo only accepts one room type per request, retain the existing valid XML shape and gain speed from compact server expansion, date-range collapsing, concurrency, and zero browser round trips.
- Keep a compatibility path for existing draft rows: migrate any unsent rows into push runs and stop creating new user-facing drafts.

## 3. Simplify the user experience
- After Save/Publish, immediately close the editor and show the new prices in the grid. Use one short success toast such as “Prices sent to Previo.”
- Remove the push progress/status bar, “waiting to send,” “confirming,” draft review, stop, retry, and manual confirmation UI from the main calendar.
- Do not show a pending indicator. Background verification updates silently.
- If Previo rejects a write, a worker exhausts its retries, or read-back finds a different price, show the existing red cell/date marker. Its history opens the exact requested price, actual/error, time, room type, and retry outcome.
- Retry transient failures automatically. Reserve a user action only for a persistent error that cannot be repaired automatically.

## 4. Extend automation per property
Add settings to the existing hotel-scoped automation rule:
- **Positive pickup:** enabled switch, strict new-booking age/lookback, booking-window tiers, first/repeat pickup amounts, repeat window, room scope, minimum ADR, per-event maximum, and daily increase cap.
- **No pickup:** separate enabled switch; configurable lookback; future booking window (default six months); up to three hotel-local run times; €1–€3 decrease per run; room scope; minimum ADR; and a maximum cumulative decrease per stay date per local day (default €10).
- **Safety:** positive and no-pickup decisions are mutually exclusive for the same stay date/run. Negative pickup never raises a price. A no-pickup markdown requires zero new bookings in its configured lookback; negative pickup may qualify for markdown but never for an increase.
- Use each property’s configured timezone and currency rather than hard-coded EUR labels or UTC day boundaries.
- Preserve the existing “copy settings from another hotel but keep automation off until explicitly enabled” behavior.

## 5. Make automation precise and auditable
- Extend automation actions so both `positive_pickup` and `no_pickup_markdown` decisions record the observation window, net pickup, triggering reservation when applicable, schedule slot, old/new price, cap applied, rule version, and publish-run ID.
- Prevent duplicate application with a unique decision key per hotel, stay date, room type, occupancy, rule version, source event/schedule slot, and local business date.
- Calculate the daily €10 markdown cap from successfully queued/published automation actions, not from browser state.
- Route all automation writes through the same durable publisher as manual edits. The engine creates absolute target prices; the push worker handles Previo, optimistic mirroring, retries, and background verification.
- Keep all reads/writes filtered by both hotel and organization. Preserve current RLS and service-role boundaries.

## 6. Automation settings UI
- Rework the sheet into two clear sections: “Raise prices on new pickup” and “Reduce prices when there is no pickup.”
- Use property-local time selectors for Morning / Afternoon / Evening, amount controls, six-month window, €10 daily cap, floor/minimum ADR, and room scope.
- Show a plain-language rule preview with concrete examples before saving.
- Keep activation deliberate per property. Saving an enabled auto-publish rule retains the existing confirmation dialog; routine price publishing requires no confirmation.

## 7. Validation and rollout
- Add unit tests for date-range compression, occupancy ladders, compact bulk expansion, idempotent retries, stale-run recovery, positive/zero/negative pickup, timezone schedule slots, minimum ADR, and daily caps.
- Add Edge Function tests proving a request returns quickly after enqueue, a 1,000+ cell operation is compressed correctly, verification is asynchronous, and mismatches become red failures without blocking the user.
- Test first with Ottofiori using dry-run decision output and a small live rate range, then verify a longer range. Preserve RD Hotels, SLNT, and other properties unchanged unless their own rule is explicitly configured.
- Record run duration, number of requested cells, compressed Previo messages, accepted/failed messages, and verification result so performance can be measured without exposing a progress workflow to users.

## Technical changes
- Database migration: extend `revenue_pickup_automation_rules` and actions; add durable push runs/items, indexes, grants, RLS, and atomic claim/recovery helpers.
- Edge Functions: split enqueue, worker, verification, and automation decision responsibilities; reuse shared Previo credential, mapping, ladder, and write helpers.
- Frontend: replace draft-save/push calls in the grid and bulk editor with enqueue calls; optimistically refresh prices; remove pending/progress UI; retain only persistent red-error history.
- Scheduler: keep the 15-minute automation tick for pickup detection, gate no-pickup runs by each property’s configured local slots, and add a frequent lightweight worker/recovery invocation.
