# Fix revenue publishing, KPI consistency, sync throttling, and tab isolation

## Goal
Restore immediate Previo price publishing, make property comparison KPIs agree with the selected monthly headline, stop unnecessary cross-user refreshes, and keep each browser tab pinned to its own property.

## Changes

1. **Remove the false client-side price block**
   - Remove the Rate Grid’s readiness banner and pre-publish guard.
   - Let the existing rate-publishing Edge Function remain the source of truth for role, PMS account, and shared Previo credential validation.
   - Keep real publishing errors visible through the existing progress/error state.

2. **Use one month and one KPI formula**
   - Lift the selected month from the monthly performance header into the revenue page so the comparison chart receives the same month.
   - Calculate comparison Occupancy as sold room-nights divided by available room-nights, ADR as revenue divided by sold room-nights, and RevPAR as revenue divided by available room-nights.
   - Include zero-occupancy days instead of silently dropping them.
   - Use the current page’s live metrics for the selected property and the newest per-date snapshots for sister properties.
   - Keep the selected property first and selected in the comparison controls.

3. **Enforce property-wide 30-minute freshness**
   - Remove forced `autosync=1` navigation behavior.
   - On page entry and periodic checks, consult shared `pms_sync_history`; run a full refresh only when that property’s successful revenue data is older than 30 minutes.
   - Replace the unconditional five-minute full sync with a lightweight freshness check.
   - Apply the same shared freshness rule to the global Live Sync revenue pull so another user or tab does not immediately repeat a recent refresh.
   - Manual “Sync now” remains immediate and always available.

4. **Pin property state per browser tab**
   - Seed each tab’s `sessionStorage` property selection on its first profile load, not only after using the switcher.
   - Preserve that pinned property when profile data is refetched after focus, auth refresh, or language changes.
   - Continue updating the account’s default property for future tabs while preventing already-open tabs from moving.

## Validation
- Confirm a manual price change queues immediately without the obsolete “no active PMS connection” message.
- Confirm the selected property’s Occupancy, ADR, and RevPAR match between the monthly header and comparison card for the same month.
- Confirm two tabs can remain on different properties through focus changes and language changes.
- Confirm a second page/user opening a property within 30 minutes reads existing data without launching another Previo revenue sync; confirm manual sync still works.

## Technical notes
- No new tables are required.
- Tenant and hotel filters remain intact.
- Backend publishing authorization and credential checks are unchanged; only the inaccurate browser-side duplicate check is removed.
