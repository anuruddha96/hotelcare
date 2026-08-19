# Fix partial automation coverage, stalled near-term dates, missing header dots, and a €150 far-out floor

## What the data shows

- **Oct 11 moved on one room type only.** At 05:00 today the engine wrote exactly one markdown for Oct 11 (Ekonomický, 1 guest, €163 → €162), while the other 12 cells of that date sat untouched. Ottofiori has 2,470 price rows in the automation horizon but every engine read is written as `.limit(50000)` against PostgREST, which caps responses at 1,000 rows. The engine therefore sees a truncated slice of the calendar (ordered newest-captured first), so whole dates and the lower cells of a date are never even considered. Same truncation applies to the daily snapshots, drafts and audit reads.
- **Aug 21 has not moved since yesterday.** Occupancy is 90.5% (19/21 sold), the last human edit was 18 hours ago (hold expired), and the sold-out guard is off — so nothing hard-blocked it. It is stopped by the smart-pricing "demand is healthy" test: occupancy is above the healthy threshold, and the immediate-window force-markdown only fires below 90% (sold-out pct 100 minus 10). Result: a date two days out with 2 rooms left and no pickup does nothing.
- **Purple cell dot on Oct 11, no dot in the date header.** The cell dot is built from three merged sources (database markers + automation actions + cell history + just-published state); the date-header dot is built from database markers alone. When a cell's newest marker row is missing or carries a source that maps to no colour, the cell still shows purple from the automation feed while the header stays blank. Cell dots are also off by default today.
- **Far-out floor.** The rule currently protects €100 from 7 days out with a €25 top-up; the request is €150 from 90 days out with a €50 top-up.

## What will change

### 1. The engine reads the whole calendar
Add a small paged reader in `revenue-pickup-automation` and use it for every large read (room-type rates, daily snapshots, rate drafts, booking/cancellation nights, today's actions, audit). It fetches in 1,000-row pages using `.range()` until a short page comes back. After this, every cell of every date in the horizon is evaluated in one run, so a markdown applies to all room types of a date instead of whichever ones happened to fall in the first page.

### 2. Near-term dates keep moving when nothing is booking
Inside the immediate selling window (0–14 days), a date with rooms still to sell is stimulated by the base step (€1) even when occupancy is above the healthy threshold — the "demand is healthy" skip no longer applies there. The true sold-out block, the manual-edit hold, the cancellation cooldown, the daily cap and the ADR floor all stay exactly as they are. Aug 21 (2 rooms left, no pickup) will step down €1 per evaluation up to its daily cap.

### 3. Date-header dots match the cells, and cell dots are on by default
The date header will aggregate the same merged event list the cells use, so a purple cell can never sit under an empty header. Where a date has changes from more than one origin in the window, the header shows up to three tiny dots (team blue, automation purple, Previo orange, red for "did not land"). Per-cell dots default to on; the show/hide link and its saved preference stay.

### 4. €150 floor beyond 90 days, with a €50 rebound
Rule settings for Ottofiori: top-up threshold €150, top-up amount €50, applies from 90 days out. The markdown pass already treats the top-up threshold as a hard floor for dates past that horizon, so a far-out price can never be walked below €150; when a price sits at or under €150 the top-up pass lifts it to €200 and normal markdown rules resume from there. The Automation Rules screen labels are updated to say "never below X beyond N days; top up by Y when it reaches the floor".

## Technical notes

- New `pagedSelect()` helper inside `supabase/functions/revenue-pickup-automation/index.ts`; all `.limit(20000/50000)` reads route through it. No schema change.
- `smartMarkdownAllowed` gains an `immediateWindow` escape in `supabase/functions/_shared/pricingRules.ts`, applied only when rooms remain to sell.
- Header aggregation moves into a memo over the merged per-cell events in `src/components/revenue/RateStrategyGrid.tsx`; `src/lib/rateOrigin.ts` gets a small `dayOriginsFromEvents()` helper so cells and header share one source of truth.
- Far-out floor is a data update to `revenue_pickup_automation_rules` for Ottofiori plus copy changes in `PickupAutomationRules.tsx`; the engine logic already honours it.
