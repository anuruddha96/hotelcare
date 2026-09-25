# Hotel Memories Budapest — missed housekeeping service carry-forward

Date: 2026-09-25  
Scope: **Hotel Memories Budapest only**  
Activation: **Budapest business date 2026-09-26**

## Goal

If a scheduled Hotel Memories stayover service was due yesterday but was not completed because the room ended as **DND** or **No Service**, HotelCare carries that exact service into the next eligible stayover day.

Covered services:
- towel change;
- full room cleaning / Change Room.

A checkout clean always supersedes the carry-forward.

## Operational rules

1. The previous Budapest business day must be finalized in `housekeeping_room_snapshots.final_state`.
2. Yesterday must contain a real towel-change or Change Room requirement.
3. Yesterday must end unresolved:
   - DND evidence, or
   - `service_result = guest_declined` / No Service.
4. A later successful clean on the same day cancels the carry.
5. Today must still be an eligible stayover:
   - not checkout;
   - not No Show;
   - not cancelled;
   - not an unarrived/new guest replacing yesterday's stay.
6. The carry-forward is assignment-scoped. It does **not** rewrite:
   - `rooms.notes`;
   - DND state;
   - PMS classification;
   - manager notes;
   - another hotel's housekeeping policy.

## Housekeeper experience

The Hotel Memories room card shows a prominent **Carried service from yesterday** instruction.

Examples:

- DND + towel:
  > Yesterday (2026-09-25) this room was DND, so the scheduled towel change was not completed. Please attempt the towel change today.

- No Service + full clean:
  > Yesterday (2026-09-25) the guest declined housekeeping (No Service), so the scheduled full room cleaning (Change Room) was not completed. Please attempt the full cleaning today.

The instruction uses the existing `translate-note` edge function, so the housekeeper can translate it into the selected language.

The carried service also affects Hotel Memories work priority and effective room-card requirements:
- carried towel change behaves like today's towel-change requirement;
- carried full clean behaves like today's full-clean / Change Room requirement.

## Manager experience

The Hotel Memories management mirror shows the same carried requirement, source date, reason and instruction. Manual manager notes remain separate and are never overwritten.

## Data model

The existing `room_assignments.previous_day_context` JSON field stores:

```json
{
  "version": 2,
  "source_business_date": "2026-09-25",
  "had_dnd": true,
  "had_no_service": false,
  "service_result": null,
  "towel_change_required": true,
  "linen_change_required": false,
  "carry_forward": {
    "version": 1,
    "active": true,
    "source_business_date": "2026-09-25",
    "service_type": "towel_change",
    "reason": "dnd",
    "instruction": "Yesterday (...) ..."
  }
}
```

No new live room state is introduced.

## Timing

Next-day plans may exist before midnight, before the previous day can legally be finalized. Therefore the migration provides two paths:

- assignment-time attachment when finalized history already exists;
- a server-side refresh every 10 minutes that enriches open Hotel Memories assignments after finalization.

The refresh changes only `previous_day_context`.

## Safety / non-regression

The feature is guarded in the database by the exact Hotel Memories hotel aliases and starts on 2026-09-26, leaving 2026-09-25's active operation untouched.

Other hotels do not receive carried-service behavior.

Checkout/no-show/cancelled/new-arrival logic suppresses stale carry-forward instructions.

## Acceptance cases

| Yesterday | Today | Result |
| --- | --- | --- |
| Towel due + DND | Same guest, stayover | Carry towel |
| Towel due + No Service | Same guest, stayover | Carry towel |
| Change Room due + DND | Same guest, stayover | Carry full clean |
| Change Room due + No Service | Same guest, stayover | Carry full clean |
| DND then later cleaned | Stayover | No carry |
| Any missed service | Checkout | Checkout clean only |
| Any missed service | New arrival / different reservation | No carry |
| DND with no towel/full-clean requirement | Stayover | No invented service |
| Any case | Other hotel | No change |

## Files changed

- `supabase/migrations/20260925153000_memories_missed_service_carry_forward.sql`
- `src/lib/hotel-memories-housekeeping.ts`
- `src/components/dashboard/HotelMemoriesRoomGate.tsx`
- `src/components/dashboard/HotelMemoriesManagerRoomOverview.tsx`
- `src/components/dashboard/MobileHousekeepingView.tsx`
- `src/components/dashboard/HousekeepingStaffView.tsx`
- tests under `src/lib/**`
