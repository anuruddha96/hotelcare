# Ottofiori two-way revenue manager — 5 November 2026

The owner's latest instruction supersedes the earlier automatic occupancy/event positioning policy: when a soft date has no booking for several hours, test a lower price; a fresh booking can justify a small increase; several recent bookings support a larger demand response. An earlier increase must not lock a date against reductions for the rest of the day. Protect verified high-impact events and dates with strong occupancy or recent pickup.

## Why the previous policy was unbalanced

The 12:53 UTC run raised two dates and reduced none. Seventy-six dates were blocked by reduction-spacing rules. The previous policy used 12/24-hour spacing on distant dates, a same-day one-way rule, and upward positioning toward an occupancy/event anchor without fresh bookings. A separate seasonal reserve could hold soft prices even without current demand.

## Current decisions

- The same production engine evaluates today through D+120, always including the requested next three months. It refreshes the authoritative Previo prices, reservations, availability and cancellations before evaluating. Scheduled evaluation normally occurs about every twenty minutes.
- An increase requires a genuine, unconsumed active booking inside the date's quiet window. Old unconsumed bookings cannot cause delayed increases after demand has gone quiet. One soft-date booking earns at most €1 inside seven days or €2 further out. Multiple fresh bookings use the configured pickup ladder and daily cap.
- Unchanged occupancy or an event label cannot generate repeated automatic increases. High occupancy or a verified high-impact event protects the current offer until new booking evidence justifies a rise.
- Protection for strong pickup uses all active bookings in the preceding six hours, including bookings already consumed for one increase. Spending a booking's increase does not erase the demand evidence. Two or more active bookings in six hours protect the offer.
- On every other sellable date, a completed quiet window is itself a reason to reduce; the date need not also be behind a pace target or above a seasonal anchor. Tests are €1 for scarce unprotected inventory, €2 for distant dates, and €2–€6 closer in, constrained by each date's remaining daily allowance.
- A quiet date can reduce after an earlier same-day increase, once its quiet window, direction cooldown and reduction spacing are satisfied. A fresh booking can reverse a reduction upward. Another reduction must wait for the next observation interval.

| Arrival lead | Quiet period before reducing | Minimum time between reductions | Daily downward cap |
|---|---:|---:|---:|
| Today–2 days | 2h | 2h | €12 |
| 3–7 days | 3h | 3h | €10 |
| 8–14 days | 4h | 3h | €8 |
| 15–30 days | 4h | 3h | €6 |
| 31–120 days | 6h | 3h | €6 |

High occupancy means at least 85%, or strong early occupancy of at least 50% and ten points above the saved lead-time pace target. The owner-requested protections take priority over a quiet-period markdown, including inside the last seven days.

## Controls and evidence

Hard manager locks, the four-hour soft manual-edit hold, absolute hotel price bounds, whole-date/all-13-cell integrity, daily budgets, four-markdown daily count and 25% campaign/recent-peak depth guard remain. The ordinary booking brake is at most four hours and never longer than the configured quiet window. Cancellation/rebooking protection is at most two hours inside seven days and four hours further out, with the configured one-hour initial cancellation cooldown. Direction changes wait three hours, except fresh pickup can justify an earlier upward reversal. This opt-in same-day reversal policy is Ottofiori-only; other hotels retain their previous behavior.

Hotel/month ADR targets remain objectives across the portfolio of nights, not a per-night minimum imposed on empty dates. Existing targets remain November €140, December €155, January/February €130. The 100% occupancy objective cannot guarantee bookings; floor-bound dates require review of availability, restrictions, channel competitiveness and conversion rather than unlimited discounting.

Each decision explains the quiet interval or fresh pickup count, occupancy, remaining rooms and the reason for the move or protection. Queued, PMS-accepted, read-back-verified and OTA-displayed prices are different states. Do not claim OTA verification from a completed engine run.

The earlier deployment moved 88 dates and a full Previo readback matched 1,136/1,144 intended prices; eight guest-count values were returned higher by Previo. Their authoritative values were retained and stale retry intents closed. Current decisions always start from fresh PMS values.

Validation includes two-way rise→quiet→fall and fall→booking→rise sequences, repeated quiet reductions, old-booking expiry, consumed-booking demand protection, event/high-occupancy holds, floor/budget/manager controls and whole-date publisher integration tests.

## Publisher integrity correction

The final Ottofiori publisher now applies the measured single-booking safety rule before any Previo write. A date at or above 85% occupancy, or at least 50% occupied and ten points ahead of its saved lead-time pace target, is treated as strong occupancy rather than a soft date. The database item-status trigger uses the same definition, preventing a PMS-accepted whole-date change from being mislabeled as failed after delivery.
