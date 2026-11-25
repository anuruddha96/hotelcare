# Melodia_113 Gozsdu room 17 invisible in progress — investigation 2026-09-19

Screenshots: eight total tasks, three completed, one in progress, four waiting. One layout shows four waiting rooms (excluding room 17); the other shows room 17 in progress.

Confirmed source mismatch: `src/components/dashboard/HousekeepingStaffView.tsx` initializes statusFilter to `assigned` and fetchAssignments filters `status IN ('assigned','dnd_pending_retry')`. It therefore hides every in-progress assignment by default. `src/components/dashboard/MobileHousekeepingView.tsx` instead initializes statusFilter to `null` and removes only completed tasks. Which view appears depends on the responsive `useIsMobile()` branch in HousekeepingStaffView; investigate stale client bundle and breakpoint independently.

Required fix: default desktop/tablet to unfiltered active assignments, mirror mobile; always pin the current in-progress assignment with a Resume action when any status or workload filter conceals it. Make second-room blocking error name/link the blocking room, not merely reject. Refresh assignment lists on INSERT/UPDATE/DELETE, app resume and focus; do not permit stale responses to overwrite fresh state; use Budapest date and correct user/hotel scope. Ensure mobile and desktop viewports both show 5 active tasks including room 17 for the reported 8/3/1/4 scenario. Test filtered views, stale-cache reload, cross-device status updates, hotel scoping and legitimate completion before merging.

Investigation only; no application code or production data changed by this document.