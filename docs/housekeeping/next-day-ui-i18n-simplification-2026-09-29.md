# Next-day housekeeping UI simplification and localization

Date: 2026-09-29

## Current-state findings
- The next-day flow reuses the large Auto Room Assignment board, which is functionally strong but exposes operational/debug information that managers do not need for routine planning.
- The shared translation system covers many `autoAssign.*` labels, but the next-day additions contain hard-coded English strings in `AutoRoomAssignmentImpl.tsx` and `NextDayAutoRoomAssignmentGate.tsx`.
- This creates mixed Hungarian/English screens such as “Tomorrow · 08:00 release”, “Laundryner duty”, “Unsold now”, “Regeneration goal”, “Assign here”, bulk-selection guidance, and PMS preparation copy.
- The preview header duplicates information: totals, a long legend, fairness diagnostics, regeneration controls and multi-line movement instructions all compete for attention.
- Mandatory controls are staff selection, room workload visibility, regenerate/rebalance, manual room movement, maintenance/exclusion, confirmation, public-area assignment and 08:00 release choice.

## UX target
1. Use the signed-in user's application language for all next-day-specific copy.
2. Keep the workflow at four steps, but make each step task-oriented and manager-readable.
3. Keep safety-critical and operational controls; reduce explanatory/debug noise.
4. Preserve all property-specific assignment logic, PMS verification, Gozsdu Laundry duty separation, room eligibility rules, public-area mapping and release safeguards.
5. Keep room chips compact and retain status signals (checkout/daily/unsold/RTC/hold/towel/linen) without forcing users to read a large legend.

## Implementation
- Add a dedicated next-day UI translation helper and use it for next-day-only copy.
- Replace hard-coded English in the assignment board and PMS gate with localized labels.
- Shorten instructions to action-first copy.
- Simplify Laundry duty messaging and PMS safety messaging.
- Rename “Regeneration goal” to a manager-facing “Rebalance plan” concept.
- Keep the existing assignment algorithm and persistence logic unchanged.

## Acceptance criteria
- Hungarian users do not see English next-day planner instructions/labels introduced by this flow.
- Existing `autoAssign.*` translations continue to be used for shared live-day controls.
- No change to room counts, assignment eligibility, Gozsdu building rules, Laundry duty, public-area persistence or release worker behavior.
- Next-day PMS verification still blocks planning on invalid/stale data.
- Managers can still select staff, regenerate, move one/many rooms, set maintenance holds, share next-day cleaning, confirm, add public areas and approve/release.
