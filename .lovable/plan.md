# Fix multi-price pushes, a mobile-first rate calendar, and an events row

## 1. Why bulk pushes fail (confirmed from Previo's own message)

Previo answers every failed row with:

```text
eqc:AvailRateUpdate -> 400: 3092 Occupancy level problem with rate plan 314803:
levels of each occupancy have to be created sequentially and in order.
You tried to skip a level (last level created was 0 and you tried to create level 2).
```

Today `revenue-push-drafts` sends one `AvailRateUpdateRQ` per draft row, containing a single `<PerOccupancy occupancy="2">`. Previo will not accept occupancy 2 unless occupancy 1 is present in the same message. A single-row push of a 1-guest price succeeds — which matches the one push that worked.

**Fix:** push per date + room type, not per draft row.

- Group all drafts for the same stay date and room type into one EQC message.
- Fill in every occupancy level from 1 up to the highest level that exists for that room type, taking the current published price from the grid data (or `getRates`) for levels the user did not edit, so nothing else changes.
- Send them in ascending occupancy order inside one `<Rate>` element.
- Mark every draft in the group pushed/failed together, keeping the verbatim Previo message on failure (current retry behaviour stays).
- Same grouping in the write-access probe so the check reflects reality.

## 2. Rate & pickup calendar — mobile-first and clearer

- **Date header:** a chevron appears on hover (and is always visible on touch) on each date cell; tapping the date or the chevron opens the change tool. Today keeps its ring; the header shows a small tooltip on the date range affected, as in Previo's "season covers only one night" hint.
- **Fix `Amount in [object Object]`** — the label prints the currency config object instead of the code; it becomes `Amount in Ft` / `Amount in €`.
- **Change-prices sheet:** on phones it opens as a bottom sheet with large tap targets, stepper buttons (−5 / −1 / +1 / +5), presets as chips, and a sticky "Save N drafts" footer. On desktop it stays the dialog it is now.
- Room-type chips become clearly toggled (selected state), the preview list scrolls, and a plain-language line states what will happen ("13 prices on 20 Aug, all room types, +2 Ft").
- The grid itself gets touch-friendly horizontal scroll with snap on date columns and a compact mode below 640px (fewer visible rows by default, summary rows collapsible).

## 3. Events row driven by AI, plus manual events

`market_events` already exists and `revenue-events-fetch` already asks OpenAI for Budapest events; nothing shows it in the calendar and nothing runs it on a schedule.

- **New "Events" row** in the Rate & pickup calendar, above Pickup: a coloured marker on each date covered by an event, sized by expected impact, with the event title(s) and venue in the tooltip. Multi-day events render as one continuous bar across their range.
- **Manual events:** an "Add event" action opens a small form (title, date range, impact, note). Manual rows are marked as user-entered and never overwritten by AI.
- **Scheduled refresh:** run `revenue-events-fetch` twice a day (08:00 and 20:00 Europe/Budapest) via pg_cron, not on every PMS sync. The function is made schedulable (service-role path, no user token) while keeping the manual "Refresh events" button for admins.
- AI is instructed to return correct multi-day ranges (Sziget, F1 weekend, conferences) and a confidence value; low-confidence entries appear faded and flagged "unconfirmed" rather than being hidden.
- Events feed the demand grading and the AI analysis text, so a high-impact date reads "Sziget Festival — consider a higher tier".

## 4. Carried-over items from the earlier requests

Delivered in this pass:
- Push retry and error visibility (kept, now with grouped errors per date/room type).
- Currency label fix across the day tool and push dialog.

Still open and included here only if you want them next (say the word and they go in):
- SLNT evening scheduling workflow and supervisor venue coverage diagram.
- Housekeeper-card status counters (done / in progress / pending / DND).

## Technical notes

- `supabase/functions/_shared/previoRateWrite.ts`: `writePrevioRate` accepts an array of `{occupancy, price}` levels and emits sequential `<PerOccupancy>` children; `readPrevioRate` gains a variant that returns all occupancy levels for a room type/date so gaps can be filled.
- `supabase/functions/revenue-push-drafts/index.ts`: group drafts by `stay_date + obk_id`, resolve full level set, one write per group, propagate result to each draft row.
- `src/components/revenue/RateStrategyGrid.tsx`: date-header chevron, mobile sheet variant of the day tool, currency label fix, events row rendering, add-event entry point.
- New `src/components/revenue/EventEditorDialog.tsx` for manual events; reads/writes `market_events` (`source = 'manual'`).
- Migration: allow manager-level insert/update of manual `market_events` rows under RLS; schedule `revenue-events-fetch` with pg_cron at 06:00 and 18:00 UTC (08:00 / 20:00 Budapest).
- No change to Ottofiori-specific behaviour beyond the push fix and the shared calendar UI; SLNT keeps HUF formatting throughout.
