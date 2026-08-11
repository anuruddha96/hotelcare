# Prices that finish, honest cell markers, and a clean hotel switch

## What I found (verified against the live database)

Pushing is **not** failing. For Ottofiori the drafts table right now holds 158 rows and every single one has status `pushed` — none are `draft` or `failed`. Of those, 119 are confirmed and 39 are "sent". The last push run logged `39 drafts → 15 date/room groups → 15 Previo messages` with no errors.

The real problem is what happens *after* a push:

- A pushed price stays in the state "sent — awaiting confirmation" until Previo's rate read-back proves it landed.
- That read-back only happens in the **nightly** sync (`previo-nightly-sync`, 00:15). Nothing else confirms a price. The 15-minute and 30-minute jobs are pickup automation and the alert engine, neither confirms rates.
- The calendar counts those unconfirmed rows in the same "N price changes waiting" banner as unsent drafts, and the push dialog lists them as rows. So a change that Previo already accepted looks identical to one that never left the app — which reads as "the rate went back to draft mode", for one day and for long ranges alike.

Cell markers: the blue/orange dot is only drawn for audit rows with source `previo_confirmed`, which are written **only by the nightly sync**. So freshly pushed cells carry no marker at all until the next morning, and there is nothing on a cell saying whether the price came from Hotel Care, from the automation, or from someone editing in Previo. The purple automation dot is keyed per date + room type + occupancy from `revenue_pickup_automation_actions`; it looks like a horizontal band because the automation genuinely re-prices one room type across many dates in one run, but with no other markers next to it there is nothing to compare against.

## What I will change

### 1. A push confirms itself, in seconds
After Previo accepts a batch, `revenue-push-drafts` reads the occupancy ladder straight back on the same connection (`readPrevioRateLevels`, already used to build gap-free ladders) and settles every draft in the batch immediately:

- price matches → `confirmed`, `confirmed_at` set, row leaves the waiting list;
- price differs → `different`, with Previo's actual value stored and shown;
- read unavailable → stays `sent`, and the nightly sync still settles it as it does today.

Each settled draft also writes its audit row right away (`previo_confirmed` for a person, `previo_automation_confirmed` for the pickup engine, `previo_different` on divergence), so the calendar shows the change and its origin as soon as the push finishes instead of the next day. Verification is one extra read per collapsed date-range message — a 75-day, 966-price push is still a handful of Previo calls.

### 2. The waiting banner tells the truth
The calendar splits the two states it currently merges:

- **"N waiting to send"** — real drafts and refused rows; this is the number on the Push button.
- **"M sent · awaiting Previo"** and **"K landed differently"** — shown separately, in muted/amber wording, with a "Check now" action that re-verifies against Previo rather than waiting for the night.

The push dialog gets the same grouping, so "Clear all" and the checkboxes are unambiguous about what is unsent versus already live.

### 3. Every price cell says where its price came from
One marker system on the cell, plus wording in the hover card and the plain `title` (so it also works on touch and in screenshots):

| Marker | Meaning |
| --- | --- |
| Blue dot (bright, ring) | Changed from Hotel Care and confirmed by Previo, last 4 h |
| Blue dot (faded/orange) | Changed from Hotel Care and confirmed by Previo, older |
| Purple dot | Pickup automation made this price |
| Amber dot | Changed in Previo (or another channel) since our last read |
| Red ring | Requested price and published price disagree |
| Dotted underline | Unsent draft |

The hover card gains a first line naming the origin explicitly: "Hotel Care · Nuwan · confirmed", "Pickup automation · +18 EUR on 2nd pickup", "Changed in Previo".

### 4. Hotel switch overlay
`HotelSwitchOverlay` renders inside the header's dropdown subtree, so it sits under the app chrome and the message lands awkwardly across the menu. It moves to a `createPortal` on `document.body` with a solid (not translucent) backdrop and centred card, so the previous property's numbers are fully covered during the swap.

## Technical notes

- `supabase/functions/revenue-push-drafts/index.ts`: add `created_by` to the drafts select; add read-back + settle + audit insert inside `processBatch` after a successful `writePrevioRate`; keep the existing failure path untouched.
- `src/components/revenue/RateStrategyGrid.tsx`: derive `unsent` / `awaiting` / `divergent` from `pending`; banner, Push button count and dialog grouping use them; add the origin marker set and hover wording; add a "Check now" that invokes the revenue sync for the affected window.
- `src/hooks/useRateAudit.ts`: include `previo_automation_confirmed` in the fetched sources and expose origin per cell.
- `src/components/layout/HotelSwitchOverlay.tsx`: portal to body, opaque background.
- No database migration required.
