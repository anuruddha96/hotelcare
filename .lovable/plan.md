# One price move per day — every room type together

Today a date can end up with only one or two room types changed, and by different amounts. Verified in the live push queue for Hotel Ottofiori: the most recent run pushed single cells on many dates (for example 25 Sep only "Deluxe Čtyřlůžkový Pokoj / 4 guests" at −76, 31 Oct three cells at −31, −6 and +11), while 4 Nov moved 10 cells uniformly by +6. So the day's step is decided once, but individual cells then get clamped to their own floor/ceiling, dropped when they are sold out, or skipped when the clamp leaves them unchanged — which produces the uneven days visible in the grid.

## What will change

The date becomes the unit of change. When automation decides a day moves, every price cell of that day moves by exactly the same euro amount, or the day does not move at all.

- The engine first computes the wanted step for the date (unchanged logic: pickup, occupancy, pace, ADR guard, anchors, events, competitors).
- It then measures how much headroom each cell of that date has before it hits its own floor or ceiling, and reduces the step to the largest amount every cell can take. Example: the day wants −10 but one room type is €4 above its floor, so the whole day moves −4.
- If the reduced step is 0 (or below the €3 minimum publishable delta), the date is held with a clear reason (`bounds_headroom`) instead of moving a subset.
- Sold-out room types now move with the rest of the day as well, so the whole day stays consistent. The frozen sold-out price capture stays as history only, it no longer freezes the cell against the day's move.
- Cells with unresolvable bounds still hold the entire date rather than letting the rest through, so a day is never published half-moved.
- After the uniform move, the existing occupancy-ladder repair runs, so 1-guest never exceeds 2-guest and supplements stay intact.

## Reporting

- The decision record for each date stores the step actually applied, the wanted step, and, when they differ, which room type limited it.
- Automation notifications say it in plain words: "All 12 prices for 4 Nov moved by +6 EUR" or "Held — Deluxe Queen is at its floor, so the whole day stayed put."

## Scope

Applies to the shared Engine V2 pricing path, so every hotel on the V2 engine (currently Ottofiori) behaves the same. No other hotel's engine version is changed.

## Technical detail

- `supabase/functions/revenue-pickup-automation/runV2.ts`: replace the per-cell clamp loop (around lines 640–670) with a two-pass build — pass 1 computes per-cell allowed movement from `boundsFor(...)`, pass 2 applies `min(|wanted|, min allowed)` signed step to all cells; remove the `typeAvail.left(...) === 0` skip for child cells (keep it for choosing the reference cell); on any `bounds_missing`/`bounds_invalid` cell, mark the date held and emit no cells.
- New fields on `revenue_date_decisions`: `movement_requested`, `limited_by_room_type` (migration).
- `_shared/priceBounds.ts`: add a `headroom(bounds, oldPrice, direction)` helper plus tests.
- `src/lib/__tests__/engineV2.test.ts`: add cases for uniform movement, headroom throttling, held-on-zero-headroom, held-on-missing-bounds, and sold-out cells moving.
- `src/lib/revenue/automationSummary.ts` + notification UI: surface applied vs requested movement and the limiting room type.
- After deploy: trigger one Ottofiori run and verify every affected date pushes the same delta across all its cells.
