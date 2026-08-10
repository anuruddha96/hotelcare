# Finish the Revenue calendar and confirmed price workflow

## Verified issues

- **Successful pushes can remain “draft”.** `revenue_rate_drafts` is unique on `(hotel, date, room type, occupancy, status)`. After one historical row is already `pushed`, a later draft for the same cell cannot be changed to `pushed` without colliding with it. The Edge Function currently ignores that update error and still reports success. The database currently has 65 Ottofiori drafts whose requested prices already match HotelCare’s latest Previo-synced prices, while recent push history reports successful writes.
- **The blue marker is not a reliable confirmed-write marker.** The calendar currently creates audit entries before Previo confirms the write, so drafts can appear as updates. Confirmed Edge Function pushes do not create their own shared audit entry.
- **Sharing is incomplete.** Activity is stored centrally, but its read policy is limited to admin/top-management roles and the hook only reloads manually; eligible colleagues do not all receive the same marker immediately.
- **The month label can slide underneath the frozen room-type column.** Its sticky offset is relative to the scroll viewport rather than the frozen column width.
- **Current order is** “How this month is performing” → “Today’s sales performance” → “Rate & pickup calendar”. The requested order is for the calendar to appear immediately after the month-performance section.

## 1. Make a confirmed Previo push final and durable

- Replace status-based draft uniqueness with one active (`draft` or `failed`) row per price cell while allowing multiple historical `pushed` records.
- In `revenue-push-drafts`, require every database status update to succeed before reporting that row as pushed. Return a specific failure if Previo accepted a write but HotelCare could not finalize it.
- Keep the immediate HotelCare price update after Previo accepts the write, then refresh the calendar and remove the completed row from Pending changes.
- Reconcile the 65 existing Ottofiori drafts that already exactly match the latest Previo-synced price, marking them pushed rather than deleting their history.
- Apply the same shared `saveRateDrafts` + `pushRateDrafts` path to the day tool, bulk editor, and reservation re-price action so all entry points behave identically.

## 2. Make the blue update marker accurate and shared

- Create the durable activity record only when a draft transitions to `pushed`; never label a saved draft as “Sent to Previo”.
- Store date, room type, occupancy, old/new price, percentage/value change, timestamp, and the user who initiated the change.
- Let eligible Revenue users read activity only for hotels they can access inside their organization; retain hotel and organization isolation.
- Subscribe to shared activity updates with proper channel cleanup so another eligible user sees a confirmed marker without reloading.
- Marker states:
  - solid blue dot: confirmed within 24 hours;
  - blue outline: confirmed within 7 days;
  - no blue marker after 7 days.
- Add a short legend above the calendar: **Blue = confirmed in Previo**, **underlined = draft**, with hover/tap showing when, who, and the exact price change.

## 3. Fix the calendar header and simplify its position

- Move **Rate & pickup calendar** directly below **How [month] is performing**, before Today’s sales performance and the pickup charts.
- Keep the visible month label outside the area covered by the frozen room-type column and calculate its sticky position from the current frozen-column width.
- Stabilize the frozen left column for one- and two-line room-type labels so wrapping cannot cover the month/date header.
- Preserve the existing expand mode, mobile day selection, and horizontal scrolling.

## 4. Validate the completed workflow

- Push the same price cell more than once and verify every attempt becomes historical `pushed`, never a stale draft.
- Verify successful, partial, and rejected Previo responses; rejected rows remain visible with Previo’s reason.
- Check that two eligible users in the same organization see the same confirmed blue marker and details, while another organization cannot.
- Test the calendar header and section order at desktop and mobile widths, including expanded mode and a two-line room label.
- Recheck the mobile month-performance scroller: smooth drift, page-scroll response, touch handoff, and stopping at the final card.

## Technical notes

- Database: adjust the `revenue_rate_drafts` uniqueness rule; add a confirmed-push audit trigger; update `rate_change_audit` read access without weakening hotel/organization isolation.
- Backend: `supabase/functions/revenue-push-drafts/index.ts` and reconciliation in `previo-revenue-sync`.
- Frontend: `src/lib/rateDrafts.ts`, `src/lib/rateAudit.ts`, `src/hooks/useRateAudit.ts`, `RateStrategyGrid.tsx`, and `RevenueHotelDetail.tsx`.