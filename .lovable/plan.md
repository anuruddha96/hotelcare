# Whole-number pricing everywhere + a faster, calmer Rate & pickup calendar

## What I checked first

- Both properties already have **whole-number prices switched on**, and the published price itself is whole (the publisher rounds before sending).
- The decimals you see come from the **step amounts**, not the final price: the engine scales a configured step (e.g. 8 EUR) by a lead-time/occupancy factor and keeps the result at cents — so it applies "19.55 EUR" or "1.50 EUR" and writes that into the explanation and the audit delta. The price then rounds, which is why "raised by 19.55" ends as +20.
- Cell history is loaded on **pointer enter with no delay**, so sweeping the mouse across a row fires a database read per cell.
- Price feedback animations run 1.1s–1.2s, which is what makes updates feel slow.

## 1. Whole numbers, end to end

- When a property has whole-number prices on, every **step amount** is rounded to a whole unit before it is applied: no-pickup markdown, pickup surcharge, second-pickup surcharge, strong-demand increase, far-out surcharge, floor top-up, event surcharge, spike/surge amounts, and the daily caps.
- A scaled step that rounds to 0 is treated as "no move" instead of a token cent change, so it is logged as skipped with a clear reason rather than producing a decimal nudge.
- The explanation line and the stored delta then read "Raised by 20 EUR", never "19.55 EUR".
- Rounding direction stays safe: markdowns round down, increases round up, and the ADR floor / top-up threshold is still respected afterwards.
- The rules editor accepts whole-number steps only for these fields when the property is in whole-number mode.

## 2. Hover that waits for you

- Cell and date history only loads after the pointer has **rested on the same cell for 2 seconds**. Moving away before that cancels the pending load, so sweeping the calendar makes zero requests.
- The hover card opens on the same dwell timing, so the popup no longer chases the cursor.
- Tap on mobile and click still load immediately — the delay is pointer-only.
- Already-cached dates still render instantly; the dwell only gates the network read.

## 3. Faster, more modern calendar feel

- Price change feedback shortened: flash and confirm drop from ~1.1s to ~0.35s, the value change gets a quick tick-over rather than a bounce, and a colour cue (green up / red down) fades within 400ms.
- Optimistic updates: an edited cell shows its new value the instant you confirm, with a subtle pending underline that clears on confirmation instead of blocking.
- Smoother horizontal movement: scroll snapping per day column, momentum-friendly arrows, and a sticky room-type column that stays crisp while scrolling.
- Selection polish: a live "N cells · date range" pill follows the selection, ESC clears it, and the selection outline animates in under 120ms.
- Skeleton shimmer for cells still loading instead of blank space, and reduced-motion support so animations respect the OS setting.

## Technical notes

- Step rounding is centralised in `supabase/functions/_shared/pricingRules.ts` (a `roundStep(amount, wholeNumbers)` helper) and applied in every pass of `revenue-pickup-automation`, so reason text, `revenue_pickup_automation_actions` amounts, and drafts all agree.
- Unit tests cover: scaled step rounds to whole, zero-rounded step is a skip, markdown never rounds up, top-up never lands below the threshold.
- Hover dwell lives in `RateStrategyGrid.tsx` as a single 2000ms timer keyed by cell, cleared on pointer leave / scroll / touch; `useCellRateHistory` stays unchanged.
- Animation durations move to `tailwind.config.ts` keyframes; no pricing logic is touched by the UI work.
