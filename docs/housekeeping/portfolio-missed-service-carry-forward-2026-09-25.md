# Mika / Ottofiori / Gozsdu missed-service carry-forward

Date: 2026-09-25  
Activation: 2026-09-26 Budapest business date  
Scope: Hotel Mika Downtown, Hotel Ottofiori, Gozsdu Court Budapest

Hotel Memories Budapest remains on its dedicated carry-forward implementation.

## Existing property mapping

| Property | HotelCare key | Current mapped inventory | Stayover service source |
| --- | --- | ---: | --- |
| Hotel Mika Downtown | `mika-downtown` | 33 HotelCare rooms / 33 active Previo mappings | Standard daily housekeeping cycle. Frozen assignment T/C instruction is authoritative for carry-forward. |
| Hotel Ottofiori | `ottofiori` / room rows use `Hotel Ottofiori` | 21 / 21 | Standard daily housekeeping cycle plus Ottofiori checkout/no-show/replacement-arrival reconciliation. |
| Gozsdu Court Budapest | `gozsdu-court` | 82 / 82 | Gozsdu property cycle and operational-room registry. No generic daily cleaning. |

The next-day policy currently maps Mika/Ottofiori through the standard daily cycle and Gozsdu through its dedicated service policy. This feature does not replace those rules. It consumes the **frozen service that was actually instructed yesterday**.

## Shared behavior

A Towel Change or Change Room / full-clean requirement carries forward only when:

1. the previous Budapest business date has finalized housekeeping history;
2. the service was actually due on the previous assignment, or was already a carried unresolved service;
3. the final outcome was DND or No Service;
4. no later successful cleaning resolved the service;
5. the room is not checkout today;
6. the reservation/stay identity has not changed;
7. the room is not cancelled, no-show or unarrived.

The context records:

- property ID;
- previous business date;
- original due date;
- service type;
- DND / No Service reason;
- attempt count;
- property policy source;
- housekeeper-facing instruction.

Repeated DND / No Service preserves the original due date and increments the attempt lineage. A naturally stronger service supersedes a weaker carried one; full clean always subsumes towel-only service.

## Mika Downtown

Mika keeps its normal daily-room workflow. Carried Towel or Change Room work is an overlay on the existing daily assignment.

The current standard service cadence is not recalculated by the carry engine; the previous day's finalized assignment instruction is the source of truth. Checkout always supersedes the carried stayover service.

## Hotel Ottofiori

Ottofiori uses the same carry mechanism but retains its stricter reservation safeguards.

A new/replacement arrival must not inherit a previous guest's housekeeping debt. Reservation ID and arrival-date continuity are checked before carrying. Existing Ottofiori no-show, not-arrived and checkout reconciliation remains authoritative.

## Gozsdu Court Budapest

Gozsdu retains its dedicated policy:

- no generic daily clean;
- property-specific Towel / Complete Textile Change cycle;
- checkout wins;
- only `gozsduAvailability.status = operating` rooms participate;
- manager same-day service overrides and building-aware work remain separate.

A missed service does **not shift the Gozsdu cycle**. It becomes a temporary service debt.

Because a normal Gozsdu no-service day may have no assignment at all, the server can create one carry-only daily assignment after today's plan establishes the active Gozsdu housekeeper roster. Assignment preference is:

1. yesterday's housekeeper if they are working at Gozsdu today;
2. least-loaded current housekeeper in the same mapped Gozsdu building;
3. least-loaded current Gozsdu housekeeper.

The created assignment keeps the carry context but does not mutate `rooms.towel_change_required` or `rooms.linen_change_required`.

## User experience

Housekeeper cards display:

**Carried service from yesterday · YYYY-MM-DD**

with the exact reason and service. The note can be translated through the existing `translate-note` function.

Manager room chips use the effective carried T/C service and show a carry marker. Desktop and room-detail manager views show the full instruction and repeated-attempt lineage.

## Safety

- No live 2026-09-25 housekeeping assignment is changed by this feature.
- Hotel Memories is excluded from the shared portfolio path.
- Manual room notes and manager instructions are never overwritten.
- PMS checkout/new-arrival authority can remove a stale carry automatically.
- Gozsdu carry-only assignment creation waits for a real current-day Gozsdu roster instead of inventing a housekeeper.

## Main implementation files

- `supabase/migrations/20260925180000_portfolio_missed_service_carry_forward.sql`
- `src/lib/housekeepingCarryForward.ts`
- `src/components/dashboard/AssignedRoomCardLegacy.tsx`
- `src/components/dashboard/HotelRoomOverviewLive.tsx`
- `src/components/dashboard/HousekeepingStaffView.tsx`
- `src/components/dashboard/MobileHousekeepingView.tsx`
