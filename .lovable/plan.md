# Safer near-term pricing, whole numbers, availability moves and cancellation insight

## What I verified first (live, no changes made)

- **Memories automation is genuinely off**: its rule row has `is_enabled = false`, `next_run_at = null`, last evaluated 09:00 UTC (before you turned it off at 09:47). Prices you still saw moving afterwards are **older queued work draining out of the publisher queue**, not new decisions. There is currently no "stop and clear queued work" action when a property is switched off.
- **Night automation did run.** Both properties produced decisions every single hour through the night (00:00–09:00 UTC). What is missing is *visible evidence* — the panel does not show a run log or the next scheduled time in a way you can trust.
- **Volume is very high**: roughly 800–1,000 decision rows per hour per property. That is the main disk/IO pressure.
- **Money is rounded to cents**, not to whole units, in the shared pricing rules — that is exactly why decimal prices reached Previo.
- **Gozsdu Court has no revenue ingest runs at all** and its last booking-night data is from 14 Aug 05:31. It is a sync/config problem, not a chart problem.
- **There is no availability write path to Previo today** — only rate writes exist.

---

## 1. Near-term dates must not blindly go up

New per-property control group "Short booking window" (default on):

- **Protected window (days out)** — default 7.
- Inside that window, **positive pickup can only raise the price when occupancy is above a "healthy" threshold** (default 70%). Below it, pickup is recorded but the price is held or allowed to step down.
- **Low occupancy + close arrival = markdown allowed**, one bounded step, as today.
- Separate "Long booking window" group: days out threshold (default 30), occupancy threshold above which increases are allowed, and a bigger allowed step.

So the behaviour becomes: far out + strong occupancy → raise; near + weak occupancy → lower; near + weak occupancy + pickup → hold, never raise.

## 2. AI second-opinion layer

Every deterministic move is computed first. Before queuing, the batch of proposed moves for one property is sent to the AI (OpenAI via the app's configured gateway) with occupancy, days out, pickup, current price, floor and the property's own rules. The AI returns, per stay date, one of **confirm / soften / cancel** plus a one-line reason.

Hard guarantees:
- AI can **never enlarge** a move, never flip its direction, never breach the ADR floor or the daily caps.
- If the AI is slow, errors, or is disabled, the deterministic decision stands.
- The reason line is stored and shown in the cell history and in the run result.

## 3. Whole-number prices only

Rounding becomes whole-unit for every automation and publish path (EUR and HUF), with rounding chosen so a markdown never rounds back up and an increase never rounds below the floor. Rule inputs in the UI switch back to whole-number steps.

## 4. Turning automation off must stop everything

When a property's automation is switched off: mark its still-unsent automation drafts superseded, close the empty queue runs, clear `next_run_at`, and show a short "stopping queued changes" state. Manual work is untouched.

## 5. Show the schedule honestly

In the automation panel: **Next automatic run at HH:MM (Budapest)** with a countdown, last run time and outcome, and the last 10 runs (time, decisions, queued, blocked, failed). After "Run now" the next run is set exactly one interval later.

## 6. Cell history — longer, clearer, correct colour

- Widen the popover and show up to 10 grouped changes with generous spacing, grouped under **Today / Yesterday / Earlier**.
- Fix the dot colour: an automation-authored change must resolve to purple even when a later Previo read-back row confirms it. Manual stays blue, direct Previo change stays orange.
- Each entry reads plainly: who, when, old → new, why (pickup / no pickup / strong demand / AI softened), and where it landed.

## 7. Talk-to-configure assistant

A small chat panel inside the automation section. You type "don't raise prices in the next 5 days unless we are above 80% full" and it proposes a **diff of the exact fields** (protected window 7 → 5, healthy occupancy 70 → 80). Nothing saves until you press Apply. It can also explain any field in plain language.

## 8. Availability moves between room types (Previo write-back)

New "Adjust availability" action on a date column in the price list:
- Pick source room type and target room type, move N rooms, for one date or a date range.
- The cell shows a `+1` / `−2` badge on that date and room type, with a tooltip naming who moved it and when.
- The change is queued through the same safe publisher and written to Previo so OTAs receive it.
- Guard rails: cannot move more rooms than are free, cannot push a type below its sold count, full audit trail, reversible.

This needs a Previo availability write endpoint. First step is a read-only probe against the live account to confirm the exact call before anything is written.

## 9. Cancellation chart under the pickup horizon

New panel for eligible users showing, by booking window (0–1, 2–3, 4–7, 8–14, 15–30, 31–60, 61–90, 90+ days before arrival):
- share of reservations cancelled, no-show and stayed;
- ADR per booking window;
- cancellation rate prior to check-in.

Built from cancelled and stayed reservation data pulled from Previo into the existing revenue tables, so it stays fast and does not hit Previo on each page view.

## 10. Gozsdu Court has no data

Diagnose and fix the property's revenue sync: check its Previo credentials/property mapping, run the sync with logging, and confirm booking nights, pickup and charts populate. This is investigated first because it may be a credential or mapping issue rather than code.

---

## Technical notes

- Short/long-window fields, AI-assist mode and rounding mode are added to `revenue_pickup_automation_rules`; availability moves get their own audit table.
- Decision logic stays in `supabase/functions/_shared/pricingRules.ts` as pure functions with unit tests: near-window hold, long-window raise, whole-number rounding, AI clamp (never enlarges), off-switch draining.
- AI second opinion and the config assistant run server-side through the Lovable AI gateway; the deterministic result is always the fallback.
- The publisher queue, global lease, priority order (manual first) and purple-marker path are unchanged.
- Decision-row volume is reduced by only persisting cells that actually changed, cutting the hourly write load.

## Suggested order

1. Gozsdu data fix + off-switch draining + whole numbers + next-run display (fast, high relief)
2. Short/long booking-window controls + AI second opinion
3. Cell history UI + purple-dot fix
4. Availability moves to Previo
5. Cancellation chart
6. Talk-to-configure assistant
