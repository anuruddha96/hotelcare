# Ottofiori revenue automation — decision-logic correction

Scope: `ottofiori` only. Verified in the live database: Ottofiori is `engine_version = 2`, `mode = live`, `auto_publish = true`, `is_enabled = true`, last run 08:47 UTC today. Memories Budapest and SLNT are `engine_version = 1` with `is_enabled = false` and stay untouched. The database-performance fix (fast snapshot / manual-hold RPCs) stays in place.

Also verified: `manual_hold_hours = 24` for every hotel; `revenue_pickup_ledger` already has `increase_spent_at` (currently unused by the V2 path); newest Ottofiori competitor observation is 2026-08-27 10:43 UTC — three days old, so the 24-hour freshness rule leaves the engine with no market signal.

## What is actually blocking price moves

The last run evaluated 218 dates and moved none: 114 `manual_hold`, 48 `decrease_frequency`, 27 `on_pace`, 26 `far_out_no_markdown`, 2 out of daily allowance. Manual hold is evaluated before pickup, so genuine new bookings cannot trigger an increase, and the 24-hour window keeps a large share of the calendar frozen all day.

## 1. Manual hold: soft vs hard

- Ottofiori hold window drops from 24 h to 2 h (per-hotel setting, other hotels keep 24 h).
- Soft hold: blocks markdowns only. A genuine pickup recorded *after* the manual edit may drive exactly one upward move; the pickup is then consumed.
- Hard lock: new explicit flag set by a manager; blocks both directions until expiry, no pickup override.
- Previo pulls, reconciliation, automation confirmations and PMS syncs are never treated as human edits (source filter on the audit lookup).
- Existing manual prices are not touched — they simply expire under the new 2-hour rule.
- Activity feed labels the two states differently ("Manual soft hold" / "Manager hard lock").

## 2. One pickup, one response

- Pickup is read from `revenue_pickup_ledger` filtered to rows with `increase_spent_at IS NULL`, not "first_seen_at in last 24 h".
- `increase_spent_at` is stamped only after the resulting decision is safely queued or accepted.
- Hard-locked date: pickup recorded as a non-action outcome with a reason, not silently dropped.
- Soft hold: pickup keeps eligibility for one qualifying upward action.
- A pickup consumed on one Budapest business day cannot be reused after local midnight.
- Cancellations net off pickup only inside the same observation window and can never produce a positive signal.

## 3. Near-term sellout logic (0–7 days)

Hourly, Europe/Budapest.

- 0–2 days: no genuine pickup for 2 h and not sold out → €3–€5 markdown, step sized by occupancy, rooms left, pace and the ADR guard. Daily decrease cap €15. No markdown at ≥90% occupancy or ≤2 sellable rooms left. Pickup response: modest below 80%, stronger at 80%+, strongest safe at 90%+.
- 3–7 days: no pickup for 4 h and behind pace → €3–€5 markdown. Daily decrease cap €10. Protected at ≥85% occupancy or ≤2 rooms left.
- All daily movement allowances reset at Budapest midnight, not UTC.

## 4. Wider horizon

- 8–30 days: pickup, occupancy, pace, cancellations, ADR feasibility, fresh competitor evidence, events. Markdowns only when genuinely behind pace and past the no-pickup wait.
- 31–90 days: pickup, pace, market position, seasonal demand; infrequent no-pickup markdowns. The generic €100 anchor is replaced by the seasonal anchor (section 7); room-type master data is not overwritten.
- 91 days → last published date (derived dynamically, capped at 400 days): pickup, historical pace, events, weekday and season. No aggressive far-out markdowns, no daily competitor scans required.
- Every stay date with a valid currently published rate is evaluated.

## 5. Rolling €130 ADR guard

Not a hard floor. The optimized snapshot lookup is extended to carry revenue and ADR fields (still without loading full history). For the rolling next seven stay dates the engine computes rooms sold, capacity, occupancy, booked revenue, booked ADR, remaining room-nights, the average rate needed on the remainder to land at €130, and a feasibility flag. Test case: 111/168 sold, booked ADR ≈ €127.50, 57 remaining → ≈ €135 required.

Required remaining revenue is allocated across dates so strong dates protect ADR and weak dates keep room to sell. Markdowns that would materially break an achievable €130 target are blocked; when the target is already infeasible (e.g. today at 20/21 sold, €106.80 ADR, needing ≈ €594 against a €500 ceiling) the date is marked "ADR target currently infeasible" and optimized for safe RevPAR and sellout instead.

Plain-language decision reasons: Pickup increase, Sellout markdown, Behind booking pace, Rolling ADR protected, Event demand, Fresh market evidence, Manual soft hold, Manager hard lock, ADR target currently infeasible.

## 6. Competitor freshness at controlled cost

- Pick and document the six most comparable active Ottofiori competitors; scan those daily for the next 30 days on the economical tier.
- The remaining active competitors are staggered across days rather than all scanned daily; days 31–90 scanned less often; nothing beyond 90 days.
- Freshness: strict for 0–30 days, longer allowance for 31–90 days.
- A market signal needs ≥4 distinct valid competitor prices after outlier/stale/low-confidence rejection; otherwise "Market signal unavailable". Rates are never interpolated.
- Scheduling via supported `cron.schedule`, credentials from Vault where available; the existing AI budget and single-flight scan lease are respected.

## 7. Seasonal anchor

A read-efficient anchor built from Ottofiori's own history: realized ADR by weekday, month/season, booking pace and comparable recent stay dates, with a minimum sample size. Insufficient history → a clearly labelled conservative fallback that also damps movement size. Room-type base prices are not rewritten.

## 8. Publishing visibility

Keep the single shared queue and publisher. Each automation run links to its publisher run and updates `cells_published`, `cells_verified`, `cells_failed` from real delivery outcomes, distinguishing queued / accepted / confirmed / superseded / different / failed. "Published" is never reported from queueing alone, and the newer-price-wins retry rule stays. Automatic live publishing remains on; no per-price approval.

## 9. Testing, deployment, verification

Automated tests plus a replay of at least the last seven days of Ottofiori input history, covering: one pickup → at most one upward response per stay date; soft hold blocks markdowns; post-edit pickup increases once; hard lock blocks both directions; 0–7-day no-pickup sell-down; rolling ADR maths; infeasible targets flagged; whole-EUR prices; floors and ceilings; occupancy ladder validity; sold-out protection; no repeated or compounding event uplifts; Budapest-midnight allowance reset; all valid published dates evaluated; stale competitor data ignored; other hotels unchanged.

Then: production dry run on current data with no test prices sent, migrations and Edge Functions deployed, one controlled live run. Ottofiori stays Live only if every critical safety test passes; otherwise it returns to Shadow with the exact reason reported.

## Technical notes

- Migration: `revenue_pickup_automation_rules` gains hold/near-term/ADR-guard columns (soft-hold hours, hard-lock support, per-band no-pickup waits and daily decrease caps, ADR target and enable flag), set for Ottofiori only; `manual_hold_hours = 2` for Ottofiori.
- Hard lock stored as an explicit marker (audit source or a dedicated `revenue_manual_locks` row) so it survives the 2-hour soft window.
- `revenue_manual_hold_dates` RPC extended to return hold kind and edit source; `revenue_latest_snapshots` extended with revenue/ADR fields.
- New `_shared/adrGuard.ts` (rolling window maths + feasibility) and `_shared/seasonalAnchor.ts`; `_shared/engineV2.ts` reordered so pickup is evaluated before hold, with the new band rules; `runV2.ts` wires ledger consumption, Budapest-local day boundaries and publisher-derived counters.
- `competitor-rate-scan` gains tiering/staggering; `cron.schedule` jobs added for the daily six and the staggered set.
- Tests extend `src/lib/__tests__/engineV2.test.ts` plus a new replay harness.

## Final report

On completion: root causes, files changed, migrations, cron changes, functions deployed, Ottofiori settings before/after, test and replay results, rolling seven-day occupancy/ADR, required remaining rate, feasibility result, competitor coverage and freshness, Live/Shadow status, run ID, dates increased/decreased, cells queued/accepted/confirmed/failed, next scheduled run, whole-EUR confirmation, and confirmation that no other hotel changed.
