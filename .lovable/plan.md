# Fast, visible Previo pushes and accurate automation markers

## Verified current behavior

- Previo accepts rate writes, but the push function does not update `revenue_room_type_rates`, which is the calendar’s published-price source. Once a confirmed draft disappears from the pending overlay, the grid falls back to the old mirrored price.
- Bulk writes are already collapsed into Previo date ranges, but each range then blocks on read-back and performs confirmation updates one draft at a time. This adds avoidable latency.
- Pickup automation is running every 15 minutes in the live database. It is enabled for Ottofiori.
- The purple-dot frontend key is correct. The engine is creating the pattern: one pickup currently fans out to every available room type and occupancy on that stay date. Recent Ottofiori events created 13 price actions across five room types for each reservation.

## What will change

### 1. Make accepted prices appear immediately

After Previo accepts a date-range write:

- upsert the accepted price ladder into `revenue_room_type_rates` using its verified unique key (`hotel_id, stay_date, obk_id, rate_plan_id, occupancy`);
- preserve the hotel and organization scope on every write;
- mark drafts as sent immediately and return the accepted values to the client;
- reload the calendar price data and audit markers after the push, so the new price replaces the old value without a full Previo sync or manual “Check again”.

The UI will honestly distinguish “accepted by Previo, confirming” from “confirmed by read-back”, while showing the accepted price immediately.

### 2. Move verification off the critical push path

Keep authoritative Previo verification, but do it after the accepted response rather than making the user wait for every read:

- run targeted read-back for the pushed date ranges in background work;
- settle drafts as `confirmed` or `different` and correct the mirrored price if Previo reports another value;
- retain the nightly revenue sync as the final reconciliation backstop;
- batch confirmation updates by occupancy/result instead of issuing one database update per draft.

This keeps safety while removing the biggest latency from short and bulk pushes.

### 3. Reduce bulk-push overhead

- Send a larger push set through one function invocation so authentication, PMS-account, mapping, and settings lookups happen once.
- Keep the existing date-range collapse and bounded Previo concurrency.
- Report progress by accepted ranges/drafts and leave only genuinely failed rows retryable.
- Prevent a successful accepted push from returning to the unsent-draft list.

### 4. Correct pickup automation scope and purple dots

Add an explicit rule setting:

- **Booked room type only** — default; a pickup changes the matching booked room type instead of all five room types.
- **All room types on that stay date** — optional portfolio-wide demand response, clearly labelled.

The engine will carry the booking’s `obk_id`/room type into its decision, generate actions only for the selected scope, and write markers only for cells whose prices actually changed. Marker lookup will use the raw PMS room name rather than a translated display label to avoid silent mismatches.

Existing historical markers remain as an audit record; new runs use the corrected scope.

### 5. Make automation settings easier to trust

Improve the existing panel without turning it into a complex revenue system:

- show the selected scope in the plain-language rule summary;
- expose the existing per-event maximum increase setting;
- show last run, last successful action, changes pushed, and failed pushes;
- make “Run now” report pickups, affected cells, confirmed pushes, and failures separately;
- keep automation off by default for other hotels and keep all settings hotel-specific.

## Database and security

A small migration will add the automation scope field with a safe default of booked-room-type-only. Existing RLS, hotel filtering, and organization isolation remain in place; no RD Hotels or SLNT property will inherit Ottofiori’s enabled state or settings.

## Validation

- Push one Ottofiori cell and confirm the new grid price appears immediately, leaves the unsent list, and later becomes confirmed without manual action.
- Push a long repeated range and compare message count and completion time with the current flow.
- Run automation against a known pickup and confirm the default rule changes only the booked room type; switch to whole-date scope and confirm all affected cells are intentionally marked.
- Verify failed/different Previo responses remain visible and retryable, and test hotel switching to ensure no cross-property prices or actions appear.
