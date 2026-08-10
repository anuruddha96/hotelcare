# Revenue push fix, equal access for top management, and the SLNT scheduling work

## 1. Why price pushes say "PMS is not configured or is inactive" (verified)

Ottofiori's PMS row is present and active (`pms_configurations`: `ottofiori`, `pms_hotel_id 786631`, `is_active = true`). The failure is in our own code: four backend paths read a column that does not exist on that table —

```text
.select("pms_hotel_id, credentials_secret_name, is_active, organization_slug")
```

`pms_configurations` has no `organization_slug` column, so the query errors, the row comes back empty, and the function reports "Previo is not configured or is inactive for this hotel". Affected: `previo-rate-write-probe`, `revenue-push-drafts`, `previo-push-rates`, `_shared/previoRatePlans.ts`.

Fix: drop the non-existent column (derive the org from `hotels`/profile instead), and never translate a query error into "inactive" — a read failure must surface as its own message.

Second confirmed blocker: `previo_rate_plan_mapping` is still completely empty (0 rows, all hotels), so even with the row loaded the push has no Previo pricelist id. "Sync rate plans" will be run automatically before a push and its result reported in words.

SLNT has no `pms_configurations` row at all (it runs on `pms_accounts`), so push/probe fall back to the matching PMS account for the room type's Previo hotel id.

After that, the EQC write (`POST https://api.previo.app/eqc1/ar`, `Authorization: ApiKey …`, `AvailRateUpdateRQ`) runs and the price is read back for confirmation. If Previo rejects the write for scope reasons, the dialog shows Previo's verbatim answer plus a ready-to-send support message you can forward.

## 2. Room types missing from the rate & pickup calendar (root cause found)

Your admin account (`assigned_hotel = ottofiori`) has `organization_slug = 'slnt'`, but the `room_types` read policy requires `organization_slug = <user's org>`. Ottofiori's 11 room types belong to `rdhotels`, so they are filtered out — while `revenue_room_type_rates` has no org clause, so ADR/RevPAR/pickup keep rendering. That is exactly the screenshot.

Fix: platform roles (`admin`, `top_management`, `top_management_manager`) read room types by hotel access, not by org string — same rule the rates table already uses. Hotel-level roles keep the current org restriction, so nothing changes for RD Hotels staff or SLNT staff.

## 3. Same revenue access for top management

`isRevenueAdmin()` currently returns true only for `admin`. It will include `top_management` and `top_management_manager`: settings tabs, price editing, the day tool, drafts, push and the write-access probe (the edge functions already allow those roles).

## 4. Same housekeeping access for top management

In Team view the PMS sync control and its neighbours are gated on `admin | manager | housekeeping_manager`. `top_management` and `top_management_manager` are added to those gates (sync, auto-assign, public areas, drag-assign) so they get exactly what a manager gets.

## 5. Revenue page: clearer titles and a calmer order

New order: month KPI carousel → today's performance → **rate & pickup calendar** → charts → AI/text panels last.

- **Top cards** get an explicit heading ("This month — August 2026") and each card says what it measures. They become a slow auto-scrolling carousel (pauses on touch/hover) that you can also swipe month by month, up to six months ahead.
- **Today's performance** gets a real title and a compact decision strip: rooms left, pickup in the last 3h, ADR vs goal, and one suggested action.

## 6. "What moved in the last X days" — full booking detail

Each movement row becomes a two-line card: created date and time of the booking, stay date range with nights, guests, room type, channel, guest country when Previo returns it, gain/loss and net value. Sorted newest-created first, with a filter for gained / lost / all.

## 7. Revenue Intelligence as a step-by-step card deck

Replaces the wall of text: the analysis produces up to five recommendation cards, shown one at a time with "1 of 5", next/back, and per-card actions (Stage price change / Mark done / Dismiss) using the existing signal-action tracking. Full text stays available behind "Show detail".

## 8. SLNT: venue access, the venue-coverage map, and evening scheduling

- **Venue access**: admins assign venues per user (manager, supervisor, housekeeper) in Staff venue access; the assignment filters overview, team view, assignment lists and approvals, enforced in the database via `user_property_scopes`.
- **Coverage view for management**: from the Hotel Room Overview, managers and top management see every venue and unit, plus a coverage diagram — overlapping sets showing which supervisor covers which venues, units counted per supervisor, and unassigned venues highlighted. Split by supervisor with one tap.
- **Evening planning (Tomorrow mode)**: after the evening PMS sync, managers plan the next day — assign venues/units to housekeepers and publish. Housekeepers get a mobile-first schedule (venue, units, start time, notes) before the day starts; signing in the next morning already shows the work. The planner reads attendance, days off and break requests from HR and warns when someone is scheduled while off.
- All of this stays behind SLNT tenant flags; RD Hotels/Ottofiori keep the morning flow and current UI.

## Technical notes

- Edge functions: remove `organization_slug` from the `pms_configurations` selects in `previo-rate-write-probe`, `revenue-push-drafts`, `previo-push-rates`, `_shared/previoRatePlans.ts`; add `pms_accounts` fallback for hotels without a config row; distinguish "read failed" from "inactive"; auto-run `syncPrevioRatePlanMappings` before a push.
- Migration: widen the `room_types` SELECT policy for platform roles (org clause kept for hotel-level roles). New `housekeeping_schedules` table (hotel, org, service date, venue, unit, housekeeper, shift window, status, published_at) with GRANTs and org/venue-scoped RLS; publishing writes through to `room_assignments`.
- Frontend: `roleAccess.ts` (`isRevenueAdmin`), `HousekeepingManagerView.tsx` role gates, `RevenueHotelDetail.tsx` section order, `MonthPerformanceHeader.tsx` (auto-scroll carousel), `PickupMovementBoard.tsx` (booking detail rows), `RevenueIntelligencePanel.tsx` (card deck), `HotelRoomOverview.tsx` (SLNT coverage diagram), `StaffVenueAccess.tsx`, plus a new SLNT schedule planner and housekeeper schedule view.

## Order of work

1. Push fix + room types visible + equal revenue/housekeeping access (unblocks you today).
2. Revenue page order, titles, KPI carousel, today's performance.
3. Movement detail rows and the recommendation card deck.
4. SLNT venue scoping + coverage diagram.
5. SLNT evening planning and housekeeper schedules.

## If Previo still rejects the write

Once the code fix is in and Previo answers with a scope error, send them this:

> Hello, we integrate with Previo for hotel Ottofiori (hotel id 786631) via API key. We need to push nightly rates back to Previo. We are calling EQC `POST https://api.previo.app/eqc1/ar` with `Authorization: ApiKey <key>` and an `AvailRateUpdateRQ` (Hotel id, DateRange, RoomType id, RatePlan id, Rate currency with PerOccupancy rate/occupancy). Please confirm: (1) is the rate-write scope enabled for our API key, (2) is EQC the correct channel for rate updates on this account or should we use a different endpoint/operation, (3) which RatePlan (pricelist) ids are writable for our room type ids. Thank you.
