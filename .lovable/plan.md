# Fix change-dot colours and move the summary onto the date row

## What's wrong today

In `RateStrategyGrid.tsx` the cell dot is chosen by a fixed priority list, not by what happened last:

```
different → automation → previo → team
```

Because `usePickupAutomationActions` loads every automation action from the last 30 days, any cell the automation ever touched keeps scoring "automation" — so the price you set by hand on 12 Aug this morning still shows purple. The colour must follow the most recent change, not a ranking.

## What will change

### 1. Colour follows the latest change
Build one small "last change" resolver per cell that merges three sources and picks the newest by timestamp:

- confirmed audit rows from `useRateAudit` (`originByCell` / `manualByCell`)
- automation actions from `usePickupAutomationActions`
- Previo-side rows (`previo_external`)

Mapping, applied consistently everywhere (cell dot, date-row dot, tooltip, history panel):

- blue (primary) — changed by your team in Hotel Care
- purple — changed by the pickup automation tool
- orange (amber) — changed directly in Previo
- red — asked for one price, Previo landed on another ("did not land")
- dotted underline — draft, not sent yet

If a manual change is newer than an automation change on the same cell, the cell reads blue.

### 2. Date-row summary dots
Replace the single blue dot on the date header with up to three tiny dots (3px, bottom-centred, no layout shift) — one per origin that changed any price on that date within the last 7 days: blue, purple, orange (plus red if something failed). This row stays visible even when cell dots are hidden, so you can scan which days moved and how.

The date hover card gains a one-line breakdown, e.g. "4 by your team · 2 by automation".

### 3. Cell dots hidden by default, and much smaller
- `showMarkers` starts `false`; the existing "Show change dots" link switches them on and the choice is remembered in `localStorage`.
- When shown, cell dots become 3px and sit in the top-right corner. If a cell has both a manual and an automation change in the window, two tiny dots render side by side (newest first) instead of one.
- The legend is rewritten to the four plain-language colours above and is always visible, since the date row uses the same colours.

## Technical notes

- All work stays in `src/components/revenue/RateStrategyGrid.tsx` plus a small pure helper (`src/lib/rateOrigin.ts`) that takes the audit row, automation rows and origin info for a cell and returns `{ origin, at }[]` sorted newest-first. This helper is unit-testable and used by both the cell and the date row.
- Date-row aggregation reuses the same helper over the cells of that date, so header and cells can never disagree.
- No database, edge function or push-logic changes; the audit and automation data already carry everything needed.
