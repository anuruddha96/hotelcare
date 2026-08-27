# Make pricing-run notifications readable

## What I checked

The dialog in your screenshot comes from the pricing activity bell (`RevenueAutomationNotifications`). I looked at the actual notification records behind it. The last few automatic runs for Hotel Ottofiori look like this:

```text
17:10  2320 prices queued safely · 2320 markdowns   (0 rows of detail)
16:00  2276 prices queued safely · 2276 markdowns   (0 rows of detail)
15:00  2265 prices queued safely · 2265 markdowns   (0 rows of detail)
```

Two separate things make this confusing:

1. **The wording is internal.** "Pickups", "Cells", "Sent", "Failed" are engine terms. A run can also be perfectly successful with "0 Sent", because prices are queued first and published by the background publisher a moment later — the notification is written before that happens.
2. **The detail table is empty.** These engine-pass runs (markdowns, ladder repairs, floor top-ups) save only counts, not the individual price rows, so the table always says "No individual price rows recorded for this run."

Separate observation, not part of this UI work: the same run reports ~2,300 markdowns every hour for one property. That is worth investigating on its own — I can look into it next if you want.

## What I will change

### 1. Plain-language headline
Replace the counters row with one sentence a manager can read at a glance, plus a status line:

- "Automatic pricing lowered 2,320 prices for Hotel Ottofiori" (or "raised", "adjusted", "repaired price ladders")
- "Queued and being sent to Previo now" / "All 2,320 prices sent" / "12 prices need attention"

### 2. Simpler stat tiles
Keep four tiles but rename and only show what applies:

| Now | Becomes |
| --- | --- |
| Pickups | New bookings seen |
| Cells | Prices changed |
| Sent | Live in Previo |
| Failed | Need attention (hidden when zero) |

### 3. Explain the "why" per run
Show a short reason chip list built from what the run actually did — for example "Final selling window markdown", "Ladder repair", "Far-out floor top-up", "Pickup surcharge" — each with a one-line plain explanation on hover/tap, so the user understands the rule behind the action instead of reading raw counts.

### 4. Useful empty state
When no per-price rows were saved, replace "No individual price rows recorded for this run" with an explanation and a way forward: "This run applied a rule across the whole calendar, so prices are summarised rather than listed. Open the rate grid to see the updated dates." plus a button that opens the revenue grid.

### 5. Same simplification in the bell list
The one-line preview under each item uses the same plain phrasing and drops "0 failed" noise.

## Technical notes

- Frontend only for items 1-5: `src/components/revenue/RevenueAutomationNotifications.tsx`, with the phrasing helpers in a new `src/lib/revenue/automationSummary.ts` (derive labels from `summary`, `actions_count`, `pushed_count`, `failed_count`, `changes`).
- No database or engine changes; existing notification records render correctly with the new copy.
- Optional follow-up (say the word and I add it): have `revenue-pickup-automation` store the first ~50 affected stay dates on engine-pass notifications so the detail table can show real examples.
