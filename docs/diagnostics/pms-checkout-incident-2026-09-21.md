# PMS checkout incident — 2026-09-21

Investigation of the live checkout-room disappearance in Hotel Memories Budapest and Hotel Mika Downtown. See issue #294. Do not use old counts to auto-repair a new work day.

- 06:00 Budapest preflight: Memories 27 checkout / 44 daily of 71 (partial: 2 unmapped reservation rooms); 06:10 Mika 13 / 20 (success). Ottofiori 9 / 12, Gozsdu 30 / 52, SLNT accounts 1 + 13 checkouts.
- At 07:30:19 Budapest, Mika's 13 checkout rows acquired trigger-generated `manual_daily` overrides. At 07:37:03–05, Memories' 27 checkout rows acquired the same. All stamps lacked timezone suffix, matching the database trigger fallback rather than the explicit UI's ISO timestamp. Neither batch emitted `room_type_switched_manual` events; polling subsequently emitted phantom `checkout_confirmed` events although actual room flags were still false.
- The database trigger `enforce_manual_room_type_override()` treats any authenticated flag-only `is_checkout_room` update as an explicit manager decision, allowing a PMS refresh to accidentally create a day-long override. `src/lib/pmsRefresh.ts` and the trigger then preserve that marker. An identical function is attached to two BEFORE UPDATE triggers, increasing ordering complexity.

Remediation: only a change carrying an explicit same-day manual-move stamp and matching `manual_checkout`/`manual_daily` marker can create an override. Remove the redundant early trigger while preserving the final override guard. Do not overwrite genuine manual interventions. Any recovery of the 40 affected rooms must compare the current, mapped, same-business-day Previo departures and protect in-progress/completed assignments, cleaning state, guest history and unverified checkout/RTC.
