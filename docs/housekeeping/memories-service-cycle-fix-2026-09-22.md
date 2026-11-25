# Hotel Memories: durable service-cycle incident — 2026-09-22

The 22 September paper plan showed towel service for 034, 036, 044, 107, 108, 110, 121, 125, 130, 137, 140, 202, 203, 205, 213, 308 and change-room for 147. Today's 16 discrepancies were corrected and audited separately. Do not repeat bulk manual corrections tomorrow.

Root causes confirmed: `pmsRefresh.ts` retains previous towel and change-room flags rather than recomputing a venue-specific schedule; `PMSUpload.tsx` uses a different hard-coded 3/7 towel and 5/9 change-room cycle, deletes current-day assignments and zeroes flags before processing; merged migration `20260920150000_stop_false_service_completions.sql` was not deployed until 22 September, so the old assignment-completion trigger fabricated service dates and flags.

Operational rule to preserve: Previo's `currentNight` and `totalNights` must be authoritative for the CURRENT business day; checkout cleaning supersedes additional services; a scheduled change-room on the final occupied night becomes towels only; an actual change is recorded only by a confirmed action, not when merely due. Property policy must be editable and tenant-isolated alongside room mapping. A dated manual service override must survive subsequent same-day PMS refreshes, but not contaminate another guest/day. Existing work and history must never be deleted by an import.

Do not close this incident on a successful SQL migration alone: require tomorrow's fresh PMS sync, full 71-room reconciliation, UI/housekeeper parity, integration and isolation tests and a verified, safe manual upload path.
