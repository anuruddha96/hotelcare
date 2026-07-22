## Scope

Two fixes for manager view:

**A. Ukrainian translation gaps** (screenshots 2 & 3)
**B. Legacy Reception "Room Status Overview" (RoomManagement) accuracy + minibar sync**

---

## A. Translation fixes

Root cause: `src/lib/highlighted-translations.ts` and `src/lib/comprehensive-translations.ts` have NO `uk:` bundle. So Ukrainian users fall back to English for any key defined only there. Additionally `src/hooks/useTranslation.tsx` `uk` bundle is missing several linen/dashboard keys.

Also, the Dirty Linen column headers (`Bed Sheets Twin Size`, `Mattress cover twin`, etc.) render `item.display_name` from the DB directly instead of going through `translateLinenItem()`.

Fixes:
1. Add missing `uk` keys to `src/hooks/useTranslation.tsx`:
   - `dashboard.managementSystem` → `{hotel} — Система управління`
   - `dashboard.subtitleManagement` → `Система управління`
   - `linen.management` → `Керування брудною білизною`
   - `linen.collectionSummary` → `Підсумок збору`
   - `linen.totalCollected` → `Всього зібрано`
   - `linen.housekeepers` → `Покоївки`
   - `linen.housekeepersCount` → `{count} покоївок`
   - `linen.noData` → `Немає даних за вибраний діапазон дат`
   - `linen.exportCsv` → `Експорт у CSV`
   - `linen.mattressCoverTwin`, `linen.mattressCoverQueen`
2. Extend `src/lib/linen-item-i18n.ts` MAP with `mattress cover twin` and `mattress cover queen` → new keys.
3. In `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx` (lines 263, 283) wrap `item.display_name` in `translateLinenItem(item.display_name, t)` (import from `@/lib/linen-item-i18n`). Same for mobile summary (line 263) and CSV header if desired.

---

## B. Reception "Room Status Overview" (RoomManagement) accuracy

Screenshot 3 shows the legacy view rendering `rooms.status` (a raw DB field), plus minibar_usage with `is_cleared = false` regardless of date. Problems:

1. **Clean/Dirty out of sync with housekeeping module** — Housekeeping uses `room_assignments` + supervisor approval to change `rooms.status`. This is generally correct, but rooms flagged `Dirty` never differentiate between "yesterday leftover" vs "today". We will trust `rooms.status` but additionally derive "checkout today" / "daily today" from today's `reservations` (Budapest date), not the stored `is_checkout_room` flag which can persist from yesterday. Today = `Europe/Budapest` calendar date.
2. **Minibar count shown for the wrong day** — `RoomManagement.fetchRooms` selects `room_minibar_usage where is_cleared = false` with no date filter, so yesterday's un-cleared items keep appearing after the guest checks out. Fix: on checkout-day refill, the manager clearing (already implemented via `MinibarTrackingView` / `SupervisorApprovalView`) is what should hide it. To ensure the display matches the housekeeping module, filter minibar usage by `usage_date = today (Budapest)` OR still `is_cleared = false` — matching the same rule used in `SupervisorApprovalView` (today-scoped).
3. **Auto-clear on checkout + refill** — When a room's reservation is a checkout for today and the manager marks the room as clean/approved (post-refill), pending minibar rows for that room from prior days should be auto-cleared. Add this on the approval path in `SupervisorApprovalView.approveRoom` (already partly there for today's items) — extend to include prior-day pending rows for that room, marking them cleared with `cleared_by = auth.uid()`.
4. **Checkout vs Daily label** — Derive from today's reservation (Budapest tz) instead of stale `is_checkout_room`. Use the same helper the housekeeping module uses (`isCheckoutToday` from `HotelRoomOverview`).

Implementation:

- Add `src/lib/budapestTime.ts` helper (or reuse existing `getBudapestToday()` if present) — one function `todayBudapest(): 'YYYY-MM-DD'`.
- `src/components/dashboard/RoomManagement.tsx`:
  - In `fetchRooms`, filter minibar query by `usage_date = todayBudapest()` AND `is_cleared = false`, OR checkout-today rooms show usage since last checkout. Simplest correct rule: show usage where `is_cleared = false AND usage_date >= (checkout_date - 1)`, but for parity with the housekeeping module scope it to today only.
  - Recompute `is_checkout_room` per-render from today's reservation `check_out = todayBudapest()`.
  - Recompute status label using the same logic as `HotelRoomOverview` (`getRoomStatusKey`) — extract a shared helper `deriveRoomDisplayStatus(room, assignmentsForToday)` into `src/lib/roomDisplayStatus.ts` and reuse in both files.
- `src/components/dashboard/SupervisorApprovalView.tsx`: on approve of a checkout room, sweep `room_minibar_usage` for that `room_id` where `is_cleared=false` and mark cleared. (Do NOT delete rows.)

## Technical details

- Budapest date: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date())`.
- No DB migration needed.
- No changes to housekeeper-facing UI (per user instruction to keep this a manager/reception UI fix).
- Files touched:
  - `src/hooks/useTranslation.tsx` (uk keys)
  - `src/lib/linen-item-i18n.ts` (mattress cover entries)
  - `src/components/dashboard/SimplifiedDirtyLinenManagement.tsx` (header/mobile display)
  - `src/lib/roomDisplayStatus.ts` (new shared helper)
  - `src/components/dashboard/RoomManagement.tsx` (Budapest today, minibar scope, checkout derivation)
  - `src/components/dashboard/SupervisorApprovalView.tsx` (auto-clear prior pending on approve for checkout rooms)

## Verification

- Load `/rdhotels` with UI language = Ukrainian → subtitle, Dirty Linen page header, table headers all translate.
- Room Status Overview: room 102 with yesterday-only usage no longer shows "1 · €10.00" today.
- Marking a checkout room approved after refill clears its pending minibar rows across all views.
