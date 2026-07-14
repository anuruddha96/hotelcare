# Restore PMS Sync button in Team View

I mistakenly removed the whole `PmsRefreshButton` from Team View in the last round. You wanted only the *PMS Upload* legacy tab hidden behind an admin toggle — the **PMS Sync** button in Team View is the primary way managers/admins refresh Previo, so it must stay.

## Changes

### 1. `src/components/dashboard/HousekeepingManagerView.tsx`
- Re-import `PmsRefreshButton`.
- Re-render it in the same legacy button area it lived in before (above/near the Team Management header, next to Auto Assign / Public Areas). Nothing else in that area changes.

### 2. Keep everything else from the previous fix as-is
- `previo-pms-sync/index.ts` — `isCheckoutRoom = isCheckedOut || isDeparture` (departs-tomorrow rooms remain Daily with `C/O+1` badge). ✅ already applied.
- `src/lib/pmsRefresh.ts` — same corrected classification. ✅ already applied.
- `PMSUpload.tsx` — daily branch now catches mid-stay rows via `Night/Total`. ✅ already applied.
- `PMSConfigurationManagement.tsx` — "Show PMS Upload tab to managers" toggle stays (admins can flip PMS Upload tab visibility from Admin → PMS Config → Previo Configuration). ✅ already applied.

## Verification after build
1. Team View shows the **PMS Sync** button again (blue, top of Team Management area).
2. Click it → Previo sync runs → checkout rooms and daily rooms populate correctly for today (checkouts = depart today only; departs-tomorrow shows `C/O+1` on Daily chip).
3. Legend chips match room chips (no orphan symbols either way).
4. Admin toggle in PMS Config still shows/hides the legacy PMS Upload tab for managers.

## Not doing
- No DB migration this round — once you click PMS Sync, today's rows re-classify themselves correctly.
- No new UI, no removal of the admin toggle.
