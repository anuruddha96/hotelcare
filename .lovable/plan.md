# Why Ottofiori prices stopped moving — and how to fix it

## What the live data shows (checked just now)

- Automation is running: Ottofiori evaluated 219 dates at 12:20 Budapest today, status `completed`, no error. It runs hourly (`next_run_at 13:20`).
- It is running in **shadow mode**. `mode = shadow`, and the last three runs queued **0** price cells (9–11 dates "increased" were simulations only). Shadow was restarted today at **10:39 Budapest**.
- That is exactly why the last real price delivery was ~4 hours ago: the last automation push run was at **09:00 Budapest** (`source = automation`). Everything after that is `reconcile`/`manual`, not new pricing.
- No notification has appeared since 09:01 Budapest. The engine code does contain the new "notify on every run" logic (`runV2.ts` `notifyRun`), and the `automation_run_id` column exists with no blocking constraint — yet zero `engine_v2_run` rows exist for the 10:37, 10:39 and 12:20 runs. The deployed Edge Function is still the older build; the new notification code was never shipped.
- Activation gate as of the last run: `shadow_24h_complete: false` (2 hours), `runs_healthy: false`. Everything else passes. So the engine will not self-activate before roughly **10:39 Budapest tomorrow**, and only after 12 consecutive clean hourly runs.
- The other two hotels are switched off entirely: `memories-budapest` (`is_enabled = false` since 15 Aug) and `slnt-group` (`is_enabled = false`). Neither has run since. If prices are expected to move there too, that is a separate switch, not a bug.

## The fix

### 1. Ship the run-visibility code that never deployed

Redeploy `revenue-pickup-automation` so every run — shadow, live, no-change, timed out, failed — writes one activity item, as intended. Then confirm against the database that the next scheduled run produces a notification row linked to its `automation_run_id`, instead of assuming it.

### 2. Make silence impossible to miss

Add a hard check after deploy: if a run finishes and no notification row was written for it, the failure is logged with the insert error rather than swallowed. Today the insert error path only writes to console, which is why the gap went unnoticed for four hours.

### 3. Show shadow mode on the Revenue page

The page gives no indication that pricing is in test mode. Add a small, honest status line next to the sync row:

- "Automatic pricing is in shadow test mode — prices are calculated but not sent to Previo."
- last run time, dates checked, and how many changes were simulated
- when the automatic 24-hour safety review will complete, and which checks are still outstanding

So nobody has to guess whether the engine is alive.

### 4. Decide on activation (your call)

Two options, and this plan does not pick one for you:

- **Wait**: leave Ottofiori in shadow; it self-activates automatically once 24 clean hours and 12 healthy runs are recorded — approximately tomorrow morning.
- **Go live now**: set `mode = live`, `auto_publish = true` for Ottofiori immediately, keeping the 48-hour watchdog that returns it to shadow on any bounds, integer, stale-data or Previo failure. Prices resume moving on the next hourly run.

Tell me which and I will include it; nothing is switched to live without you saying so.

## Technical notes

- Deploy `supabase/functions/revenue-pickup-automation` (includes `runV2.ts` and `_shared/*`); no schema change is required — `automation_run_id` already exists.
- Verification is done by querying `revenue_automation_runs` and `revenue_automation_notifications` after the next scheduled run, not by reading source.
- Frontend change is confined to a status line in `src/pages/RevenueHotelDetail.tsx` fed by the existing rule row (`mode`, `last_run_at`, `gate_results`).
- No pricing logic, bands, floors or ceilings are touched. Memories, Mika, Gozsdu and SLNT stay on engine v1 and remain untouched.
