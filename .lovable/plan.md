
Goal: Fix Auto Room Assignment so results are consistently fair (no more 13 daily vs 3 daily), while keeping practical floor/zone proximity.

What is causing the bad assignments now:
1) Daily distribution has no hard fairness cap; zone clustering can dominate.
2) Rebalancing stops early if zone penalty is high, even when count imbalance is huge.
3) Affinity bonus is additive and can snowball toward already-loaded staff.
4) Regenerate currently accepts the first random result, so bad random outcomes are shown.

Implementation plan

1) Add hard fairness guardrails in `src/lib/roomAssignmentAlgorithm.ts`
- Compute per-run targets:
  - checkout min/max = floor/ceil(total_checkouts / staff_count)
  - daily min/max = floor/ceil(total_daily / staff_count)
  - total-room min/max
  - target minutes per staff
- During assignment, apply strong penalties for assigning beyond max when others are still below min.
- Keep proximity as a soft rule, not a rule that can override major fairness.

2) Fix daily-phase scoring so one person cannot absorb a whole heavy daily block
- In Phase 2 (Clean Room C) and Phase 3 (remaining daily):
  - prioritize staff with lowest daily count deficit and lowest minute deficit
  - keep zone proximity as tie-breaker / secondary factor
- Add overload penalty ramps (quadratic) for daily over-allocation.
- Keep C-room compensation: staff with fewer checkout rooms should preferentially receive C rooms.

3) Rework final rebalance into fairness-first passes
- Add explicit passes in order:
  a) checkout diff <= 1  
  b) daily diff <= 2  
  c) total rooms diff <= 2  
  d) minute spread within threshold (e.g. <= 60–75 min)
- Allow controlled cross-zone moves when imbalance is severe (instead of current hard stop at score >= 200).
- Add swap fallback (one-for-one) when direct moves are blocked.

4) Stabilize affinity and randomization
- Cap/normalize affinity bonus (avoid “rich-get-richer” accumulation).
- Reduce random perturbation amplitude significantly.
- Keep random only as tie-breaker, never enough to break fairness targets.

5) Make Regenerate quality-controlled in `src/components/dashboard/AutoRoomAssignment.tsx`
- On generate/regenerate:
  - run multiple seeds (e.g. 8–12 candidates)
  - score each candidate with a fairness score (heavy penalties for checkout/daily/total/minute imbalance)
  - choose best candidate only
- This keeps regenerate useful but prevents absurd outputs.

6) Add fairness diagnostics in preview header (small, manager-friendly)
- Show compact metrics:
  - “CO diff”, “Daily diff”, “Total diff”, “Time spread”
- If thresholds are exceeded, show warning so manager knows to drag-adjust or regenerate.

Technical details (implementation thresholds)
- Hard targets:
  - checkout: max-min <= 1
  - daily: max-min <= 2
  - total rooms: max-min <= 2
  - time spread: configurable default 75 min
- Candidate score (concept):
  - fairness penalties (counts + minutes) = primary
  - zone/floor proximity = secondary
  - affinity bonus = capped tertiary
  - random = tiny tie-breaker only

Files to update
- `src/lib/roomAssignmentAlgorithm.ts`
  - fairness quotas
  - revised phase scoring
  - improved rebalance passes + swap fallback
  - affinity normalization + reduced random impact
- `src/components/dashboard/AutoRoomAssignment.tsx`
  - multi-candidate regenerate (best-of-N)
  - fairness score selection
  - compact fairness diagnostics in preview

Validation after implementation
- Reproduce current 71-room / 5-staff Memories scenario.
- Expected result envelope:
  - checkouts mostly 6–7 each
  - daily mostly 7–8 each (not 13 vs 3)
  - total rooms around 13–15 each
  - no extreme outlier column after regenerate
- Click Regenerate 5+ times and verify all generated previews remain within fairness bounds.
