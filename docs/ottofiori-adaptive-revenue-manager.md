# Ottofiori adaptive revenue manager — 5 November 2026

The owner authorizes automated pricing for Ottofiori: sell early at the best achievable ADR, target 100% occupancy, and actively resell inventory inside the seven-day cancellation tail. This policy replaces blanket event holds, January weekend exclusions, and the one-markdown daily limit. It applies only to Ottofiori.

## Evidence before this change

The 08:53 UTC run checked 93 dates and moved none. Holds included 25 decrease-frequency waits, 21 event protections, seven markdown-count limits, five pickup-conversion holds, and seven manual protections. Mean date occupancy in that run: November 56.2%, December 53.6%, January 0.9%, February 2.9% (February only through the fifth). These are averages of current date occupancies, not final monthly outcomes. Cheapest available two-person reference rates averaged €217, €264, €189 and €221 respectively; those are asking rates, not achieved ADR.

## Commercial decisions

- Refresh reservations, cancellations, availability and the published PMS rate mirror before each evaluation. Fail closed on unsuccessful refresh. Use the existing whole-date publisher, exact room mappings, whole-euro prices and global price boundaries.
- Evaluate on a 15-minute due interval through the existing ten-minute scheduler (normally every 20 minutes). Scan today through D+120, covering the requested 90 days and all February immediately.
- Increase once per unconsumed booking, using the durable pickup ledger. A single soft-date conversion gets only €1 inside seven days or €2 further out. Strong occupancy or two-plus bookings in six hours supports larger steps from the configured ladder, within the lead-window daily cap.
- Early occupancy and verified high-impact events can move toward a finite seasonal-anchor target. Stable occupancy/event evidence cannot keep compounding prices above that target. A high-event date can reduce an overpriced offer toward its seasonal premium; inside seven days, sell-through takes priority.
- Every unsold final-week date remains eligible, including the last room and arrival day. Further out, act when at least five points behind pace. Keep room value with seasonal reserves, the hotel floor, campaign depth and daily budgets.
- Preserve hard manager locks. Protect ordinary human price edits for four hours; genuine pickup may still justify a rise. Keep booking and cancellation protections; the cancellation hold shortens to two hours inside seven days.
- ADR targets remain hotel/month goals, not a minimum rate imposed on every weak date. Existing November €140, December €155, January €130 targets remain, with February €130 added. Targets are objectives, not guarantees.

| Lead time | No-pickup wait | Reduction spacing | Daily decrease cap | Daily increase cap |
|---|---:|---:|---:|---:|
| Today–2 days | 2h | 2h | €12 | €12 |
| 3–7 days | 4h | 4h | €10 | €15 |
| 8–14 days | 6h | 6h | €8 | €18 |
| 15–30 days | 8h | 12h | €6 | €20 |
| 31–60 days | 12h | 12h | €5 | €20 |
| 61–120 days | 24h | 24h | €4 | €22 |

At most four markdowns per date per local day; distant-date spacing normally permits only one. A price may not fall more than 25% below its recent campaign peak; a seasonal reserve can stop it earlier. Reversals wait three hours, except a genuine new booking may justify an upward reversal. Dates already raised that day are not automatically cut back the same day.

Pace targets: 100% by D-7; 90% at D8–14; 80% at D15–30; 65% at D31–60; 45% at D61–120. These intentionally ambitious targets create earlier demand tests. They do not imply rooms should be discounted when scarce inventory and healthy pickup support ADR.

## Verification and operational limits

Run the revenue-director, date-budget, queue-safety and Ottofiori publication-guard Node tests. Existing all-13-cell publication integrity and PMS acceptance/confirmation distinctions remain. A queued change is not proof it was published; monitor push items and PMS refresh results. No reservation count, ranking improvement or 100% occupancy is guaranteed. Rate movement should respond to commercial evidence; arbitrary price oscillation is not a ranking strategy.

The full PMS preflight has a 90-second timeout, then the planner has its own evaluation budget. Missing rate or occupancy evidence must hold prices rather than interpret unknown occupancy as empty.


## Production verification

The deployed planner and publisher were exercised on 5 November. A dry run checked 121 dates; 13 supported increases and 75 reductions passed simulation. Live cycles delivered all 13 mapped cells on 88 distinct stay dates, including arrival day. The initial four-date rejection from the old single-booking database guard was corrected with a narrow €1/€2 allowance and successfully retried through the normal engine. A second legacy 24-hour publisher hold was aligned with the saved four-hour soft-hold policy and hard locks.

A fresh full Previo readback matched 1,136 of 1,144 latest intended prices. Eight prices across five dates (10, 11, 15 and 19 February; 4 March) were normalized upward by Previo where existing guest-count prices were inverted. Their authoritative PMS prices were retained and obsolete retry targets settled. This is a documented publication discrepancy, not an assertion that every requested price matched or that OTA display was independently verified.

Validation: 63 local Node tests (including actual publisher-handler integration), pure-planner/publication TypeScript checks, publisher syntax parsing, and three transactional tests against the live publication trigger using temporary push items. No public price or booking row was changed by the database tests. Internal scheduler/trigger RPC execution is limited to the service role. The existing hourly AI supervisor was updated to follow this policy and to distinguish PMS acceptance from verified readback.
