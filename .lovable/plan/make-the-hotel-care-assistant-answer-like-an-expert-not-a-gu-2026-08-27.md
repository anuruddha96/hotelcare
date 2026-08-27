# Make the Hotel Care Assistant answer like an expert, not a guesser

## What is actually wrong

The screenshot shows the problem clearly. The housekeeping board for Hotel Ottofiori shows 10 checkout rooms, 11 daily rooms, 1 DND room, named housekeepers with progress bars, notes, towel/linen flags and RTC/manual-checkout markers. Asked "How is housekeeping doing today?", the assistant answered "8 rooms dirty, 13 clean, multiple completed assignments" — vague, and not what the operator sees.

Verified cause: the assistant's housekeeping tool returns almost nothing. It reads only `rooms(id, room_number, status, hotel)`, counts statuses, and dumps raw `room_assignments` rows with UUIDs. It does not return:

- checkout vs daily split (`is_checkout_room`, `pms_metadata.scheduledDepartureToday`)
- who each room is assigned to (only `assigned_to` UUIDs, never resolved to names)
- per-housekeeper progress (assigned / in progress / completed)
- DND, No Service, towel/linen change, notes, ready-to-clean, manual checkout
- floors, unassigned dirty rooms, or rooms at risk before arrivals

So the model receives a thin, ambiguous payload and produces a thin, ambiguous answer. The same shallowness affects maintenance, staff-on-duty and room detail answers.

A second issue: nothing in the system prompt forces the assistant to answer with the concrete numbers and names the tool returned, or to re-check instead of restating when the user says the numbers are wrong.

## The fix

### 1. Rebuild `get_housekeeping_status` into a real operational snapshot
Return the same picture the board renders, for the requested hotel and today:

- Totals: total rooms, dirty, clean, in progress, completed, not started.
- Split: checkout rooms vs daily rooms, each with counts and room numbers by floor.
- Assignments joined to staff names (never phone/email), with per-person: rooms assigned, completed, in progress, remaining, progress percent.
- Unassigned dirty rooms — the operationally important list.
- Flags per room: DND, No Service, towel change, linen change, has note, ready-to-clean (using the existing today-guard logic), manual checkout, departs tomorrow.
- A short `dataFreshness` marker so the model can say when PMS rows are stale rather than inventing a number.

### 2. Add a supervisor-grade summary tool
`get_housekeeping_briefing` — one call that combines housekeeping status, today's arrivals/departures from the live PMS overview, staff currently signed in, and open maintenance tickets blocking rooms. This is what "how are we doing today?" should trigger, so the assistant answers in one grounded pass instead of a partial one.

### 3. Deepen the other thin tools
- `get_maintenance_tickets`: add SLA breach/at-risk flags, age, and assignee names.
- `get_staff_on_duty`: include shift start, rooms in progress, and who has not signed in but has rooms assigned.
- `get_room_detail`: include today's assignment, cleaner, flags, last cleaning and open tickets for that room.

### 4. Tighten the reasoning contract in the system prompt
- Answer operational questions with concrete numbers, room numbers and names from the tool result — never a mood summary like "the team seems efficient".
- For "how is X doing", lead with the headline (X of Y rooms done, Z remaining, who is behind), then the exceptions that need action.
- If the user says the numbers are wrong, re-run the tool for the exact hotel and date before replying.
- Never report a count the tool did not return; say what is missing instead.
- Raise reasoning effort to `high` for these operational answers.

## Validation
Run the deployed function as a real signed-in user at Hotel Ottofiori and ask "How is housekeeping doing today?". The reply must match the board: checkout vs daily counts, per-housekeeper progress, the DND room, and the unassigned/remaining rooms. Also verify a housekeeper role sees only their own scope and no other property.

## Technical notes
Changes are confined to `supabase/functions/assistant-chat/index.ts` (tool payloads + system prompt) and reuse existing scope guards in `_shared/assistantScopes.ts` and `_shared/assistantHotels.ts`, plus the same checkout/RTC rules the board uses (`is_checkout_room`, `pms_metadata.scheduledDepartureToday`, `isPmsRtcToday`). No schema changes, no role or isolation changes.
