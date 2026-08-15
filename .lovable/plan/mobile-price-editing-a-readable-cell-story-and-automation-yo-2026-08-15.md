# Mobile price editing, a readable cell story, and automation you can actually tune

## What I checked first

- The day/price tools on mobile are Radix `Dialog`s sized with `max-h-[92dvh]` and an internal scroll area plus a sticky footer — on a phone the footer sits over the change list (visible in your screenshot: the list is cut mid-row behind "Update 13 prices") and the page behind is scroll-locked, so it feels frozen.
- Tapping a cell on touch already opens a bottom sheet with history, but it shows only three grouped changes, has no single "where this price is right now" line, and the sheet is capped at 75vh with the Edit button competing for space.
- The automation settings you asked for **do exist in code** (short booking window guard, protected-window days, "only raise above occupancy %", whole prices only, AI-assisted pricing switch) — they are at the very bottom of one long right-side sheet, below five other blocks, which is why they read as missing on a phone.
- There is **no "don't raise the last room" rule** anywhere in the engine today: nothing checks rooms left / 100% occupancy before an increase.

---

## 1. Mobile price editing that behaves

- On touch, the day tool and the edit-price dialog become full-height bottom sheets: header fixed, body the only scrolling region, action bar pinned below it (not over it), safe-area padding at the bottom.
- The "N prices will change" preview gets its own scroll region with a visible fade edge, so the last rows are always reachable.
- Backdrop tap and a large close target both dismiss; while open, only the sheet scrolls — no half-locked page.
- Desktop layout is unchanged.

## 2. One clear status line per cell, then the full story

At the top of the cell sheet, a single plain-language line, for example:

```text
€211 now · automation sent €209 at 16:20 — waiting for Previo to confirm
```

Variants: confirmed in Previo, waiting to be sent, sending now, failed and will retry, changed directly in Previo. Under it:

- Current price, draft price, and who last touched it.
- The full change list, scrollable, **all** entries (not three), grouped under Today / Yesterday / Earlier, each reading: old → new, +/- amount and %, actor with the right colour (blue manual, purple automation, orange Previo-direct), the reason the engine gave (pickup / no pickup / strong demand / held by short window / AI softened), and where it landed.
- "Edit price" stays pinned at the bottom of the sheet.

Desktop hover card gets the same status line and reason text.

## 3. Don't raise the last room

New guard in the shared pricing rules, on by default:

- If a stay date has **no rooms left** (or occupancy is at/over a configurable "sold out" threshold, default 100%), automation stops raising that date — there is nothing left to sell, so the rise only risks the rate on a later cancellation.
- If a cancellation puts occupancy back below the threshold, the date becomes eligible again automatically on the next check.
- Markdowns are unaffected.

## 4. Automation settings you can find and understand

The automation panel is reorganised into labelled, collapsible sections with a one-line summary of the current setting on each header, so on a phone you see the whole map at a glance:

1. **On/off and schedule** — next automatic check, last check, run now.
2. **Immediate booking window** — protected days, "only raise above X% occupancy", allow/deny last-minute markdowns, sold-out guard, whole prices.
3. **When a booking arrives** (positive pickup ladders, caps).
4. **When demand is weak** (markdown step, daily cap, manual hold).
5. **Smart pricing** (lead time and occupancy thresholds, strong-demand rise).
6. **Safety limits** (minimum ADR, daily caps, publish switch).

Each section keeps a short "what this does in practice" sentence, and the existing plain-language summary at the top is rewritten to describe the active configuration in one paragraph.

## 5. Talk to the automation (AI configuration assistant)

A chat box inside the automation panel. You type, for example, "don't raise prices in the next 5 days unless we're above 80% full, and never raise a sold-out date". It replies with a **diff of the exact fields** (protected window 7 → 5, raise-above occupancy 70 → 80, sold-out guard on) and an Apply button — nothing is saved until you press it. It can also explain any field in plain words.

---

## Technical notes

- `src/components/revenue/RateStrategyGrid.tsx`: mobile sheet variants for the day tool and edit dialog (shared `ResponsiveModal` wrapper), scroll regions, pinned action bars.
- `src/components/revenue/RateCellHistory.tsx` + `src/lib/rateChangeGroups.ts`: status-line derivation, full scrollable list with day grouping, reason text from `ai_reason` / decision source.
- `supabase/functions/_shared/pricingRules.ts`: `soldOutBlocksIncrease()` pure function with unit tests; wired into `revenue-pickup-automation` next to `shortWindowIncreaseAllowed`, using the rooms-left figure the engine already loads.
- Migration: `sold_out_guard_enabled`, `sold_out_occupancy_pct` on `revenue_pickup_automation_rules`.
- `src/components/revenue/PickupAutomationRules.tsx`: accordion sections + summaries; assistant calls a small edge function that returns a strict JSON field diff via the Lovable AI gateway, validated client-side against the allowed field list and ranges before Apply.
- No change to the publisher queue, lease, priorities, or marker colours logic.

## Order

1. Mobile sheets + cell status line and full history
2. Sold-out guard + settings reorganisation
3. AI configuration assistant
