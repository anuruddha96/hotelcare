# Revenue write-back, room overview clarity, and SLNT scheduling

Six problems, in the order they hurt. Everything SLNT-specific stays behind tenant flags; Ottofiori/RD Hotels only get the two fixes they asked for (consistent overview, housekeeper names back on chips).

## 1. Room types and rates disappearing from the price list

Verified: the data is there (`revenue_room_type_rates` holds 2,522 rows for Ottofiori and 11,537 for SLNT; `room_types` has 11 and 34 rows, all with a Previo id). So the grid is not missing data — it renders zero room-type rows when its `roomTypes` prop arrives empty or late, which happens while the hook is still loading or if one of its parallel queries errors.

Fix:
- The grid keeps the last non-empty room-type list instead of collapsing to only ADR/RevPAR while reloading.
- When room types truly come back empty, show an explicit "Could not load room types — Retry" row instead of a silently short grid.
- Surface query errors from the revenue hook (currently swallowed) so a failed read is visible rather than looking like "the rates vanished".

## 2. Writing rates back to Previo still fails

Root cause found: `previo_rate_plan_mapping` is **empty** — no rows at all, for any hotel. Both `revenue-push-drafts` and the write probe bail out with HTTP 412 before ever calling Previo, which the UI reports as the generic "Edge Function returned a non-2xx status code".

Fix:
- Auto-derive the mapping instead of requiring hand entry: a `previo-sync-rate-plans` step reads room types and pricelists from Previo (per PMS account for SLNT) and fills `previo_rate_plan_mapping`, marking the most used pricelist as default.
- Push and probe fall back to that derived mapping and, when something is still missing, return a readable message ("No Previo pricelist found for room type X — run Sync rate plans") instead of a raw non-2xx error. Every non-2xx body is unwrapped and shown to the user.
- Rate writes keep using the documented EQC call (`POST /eqc1/ar`, `Authorization: ApiKey …`) with the correct hotel id per account, and still read the price back to confirm it landed.
- If the account's EQC key is missing, the dialog says exactly that and offers the support text.

## 3. Tap a date to change prices (modern version of the Previo group tool)

Tapping any date header opens a day/range action sheet with: open/close for sale, set price, +/- by amount, +/- by percent, round to nearest whole, and reset to previous. Scope selectors: this date, a date range, weekdays/weekends only, all room types or selected ones, all occupancies. Live preview of the resulting prices before staging, everything lands as drafts and nothing reaches Previo until pushed. HUF tenants see and type whole forints.

## 4. Housekeeper cards and room chips

- Rooms assigned to a housekeeper are always shown as chips inside that housekeeper's card, colour-coded by status with the same legend as the summary (done / in progress / pending / DND / overdue).
- The card's Done / Working / Pending / DND counters and the chips come from one derived source, so a card can never show "3 rooms" with no chips (the Svetlana case).
- Room chips in the overview show the assigned housekeeper's short name underneath again (this regressed for the venue/dense layout, which passes an empty name).
- The "Unassigned" group only renders when it actually holds rooms, so Ottofiori — where every room is assigned — no longer shows a confusing empty bucket.

## 5. Ottofiori view flipping between layouts

The overview has two layout paths plus a dense/roomy toggle persisted in `localStorage`, and staged assignments also live in `localStorage`, so a refresh or a second tab can silently swap the rendering. Fix: one layout decision derived from tenant flags (venue-grouped for SLNT, floor-grouped for hotels), the roomy/compact toggle as the only user-controlled variation, and staged assignments applied consistently so chips don't appear and disappear between renders.

## 6. SLNT: venue access + evening scheduling

- **Venue access:** admins assign venues per user (managers, supervisors, housekeepers) in Staff venue access; the assignment then filters everything they see — overview, team view, assignment lists and approvals. Supervisors with three venues see only those three and only the housekeepers scoped to them. Enforced in the database, not just the UI.
- **Evening planning:** a Tomorrow mode. After an evening PMS sync, managers plan the next day — assign venues/units to housekeepers, save as a published schedule. Housekeepers see their next-day schedule in a mobile-first list (venue, units, arrival time, notes) before the day starts, and on sign-in the work is already there.
- **Schedule and HR:** the planner shows who is available (attendance, days off, break requests) and warns when someone is scheduled while off. Published schedules feed the same assignment records used today, so nothing downstream changes.
- SLNT's cut-off (no guest requests after 17:00) drives the default planning window; RD Hotels keeps its morning flow untouched.

## Technical notes

- New flags in `src/lib/tenantFeatures.ts`: `eveningPlanning`, `venueScopedStaff` enforcement, `scheduleModule` — all off by default.
- New table `housekeeping_schedules` (hotel, org, service date, venue, unit, housekeeper, shift window, status, published_at) with GRANTs and org/venue-scoped RLS; publishing writes through to `room_assignments`.
- `user_property_scopes` becomes the single source for venue filtering; the existing SLNT-only RLS policy pattern is extended to assignments and schedules, so no other tenant's rows are touched.
- Edited files: `RateStrategyGrid.tsx`, `useRevenueHotelData.ts`, `HotelRoomOverview.tsx`, `HousekeepingManagerView.tsx`, `StaffVenueAccess.tsx`, `revenue-push-drafts`, `previo-rate-write-probe`, `_shared/previoRateWrite.ts`, plus new `previo-sync-rate-plans` and a scheduling view.

## Order of work

1. Price grid stability + readable push errors and auto rate-plan mapping (unblocks Previo writes).
2. Date action sheet for group price changes.
3. Housekeeper cards, chip names, empty "Unassigned", layout consistency.
4. SLNT venue-scoped access enforcement.
5. SLNT evening planning and housekeeper schedule view.
