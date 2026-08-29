# Restore Revenue run visibility and sync controls

## Verified current state

- Ottofiori’s latest automation check completed successfully at **10:39 Budapest time**. It evaluated **219 dates**, simulated **11 increases**, held **208 dates**, queued **0 live price cells**, and recorded no error.
- Ottofiori remains in **shadow mode**, so those 11 proposed increases were simulations only and nothing was published to Previo.
- Engine V2 currently creates activity notifications only for live runs with queued prices. Shadow runs, successful no-change runs, and failures can therefore finish without anything appearing in the notification bell.
- Existing older automation notifications have summary counts but `changes: []`, which is why their detail dialogs cannot show a real breakdown.
- The Revenue page’s `SHOW_ADMIN_TOOLBAR = false` gate hides the entire former header, including **Sync now**, the primary **last synced** timestamp, and Sync history access. There is no replacement manual sync control elsewhere.

## Changes

### 1. Make every automation run visible

Create one durable activity item for every Engine V2 outcome:

- completed in shadow mode
- completed live and queued/published
- completed with no price movement
- timed out, paused, or failed

Each item will clearly state the run mode, start/finish status, whether prices were only simulated or actually sent, and the exact error when applicable. Routine scheduler wake-ups where no property was due will remain silent.

### 2. Link notifications to the actual run breakdown

Add a nullable automation run reference to the notification record and populate it for Engine V2. When a notification is opened, load that run’s `revenue_date_decisions` and show:

- dates evaluated, increased, decreased, and held
- prices/cells simulated versus queued live
- stay date, current price, proposed price, movement, and status
- the plain-language decision reason for every listed date
- grouped explanations for held dates, such as manual hold, on pace, occupancy protection, or waiting for the no-pickup window

Keep support for older notifications that only contain their legacy `changes` payload.

### 3. Correct the manual “Run now” result

Teach the automation settings panel to read the Engine V2 response shape. After a manual check it will always show a completion dialog with the run ID, mode, health, exact counts, and a clear statement such as **“Shadow test only — no prices were sent to Previo.”** Failures and skipped runs will retain their precise backend reason.

### 4. Restore sync status without restoring unrelated controls

Add a compact Revenue status row above the calendar containing:

- **Sync now** button using the existing safe, leased sync flow
- last successful sync date and time, including who triggered it when known
- live states for updating, queued behind another refresh, fresh data, and failed refresh
- access to existing sync history for authorized revenue users

The previously hidden Bulk Edit, Pull rates, Autopilot, Push, reference banner, and old navigation toolbar will stay hidden unless separately requested.

### 5. Verify end to end

- Run Engine V2 manually in Ottofiori shadow mode and confirm it creates one readable activity item without publishing rates.
- Open that item and verify its totals match the stored run and its decision rows.
- Exercise no-change and failure handling so both remain visible and understandable.
- Trigger **Sync now**, confirm progress/duplicate-run handling, and verify the displayed timestamp advances after the published dataset reloads.
- Confirm organization and hotel isolation remain enforced by the existing revenue-user access policies.

## Technical notes

- Database: add an optional run reference on `revenue_automation_notifications`, with the existing hotel-scoped RLS retained.
- Backend: update `revenue-pickup-automation/runV2.ts` to emit exactly one terminal notification per attempted V2 run, including failure paths.
- Frontend: update the notification hook/dialog to fetch run decisions on demand; update `PickupAutomationRules.tsx` for V2 result fields; add a focused sync-status component to `RevenueHotelDetail.tsx` using the existing `requestSync`, `runSync`, and freshness state.
