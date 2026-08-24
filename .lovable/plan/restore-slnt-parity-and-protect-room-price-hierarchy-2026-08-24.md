# Restore SLNT parity and protect room-price hierarchy

## Confirmed findings

- SLNT and RD Hotels already use the same `RevenueHotelDetail` and `RateStrategyGrid` components; there is no separate or older SLNT page.
- The visible UI difference is role-based: SLNT's three executives are `top_management_manager`, while several Revenue tabs, calendar navigation, tools and layout controls are still gated by `profile.role === "admin"`. This contradicts the shared `isRevenueAdmin()` rule, which intentionally gives top management the same Revenue powers.
- SLNT has a complete published dataset (about 5 MB, 34 room types and 10,430 rate rows), refreshed today. Its two Previo accounts are correctly attached to `slnt-group`.
- The intermittent SLNT load failure is an authorization defect in the published-payload RPC: authenticated users may execute `get_revenue_published_payload`, but that invoker function calls `user_can_access_hotel`, for which the caller has no execute grant. The database log confirms `permission denied for function get_revenue_published_payload`.
- SLNT's published payload timestamp can be newer than `revenue_sync_state.last_success_at`, so the header can report stale/never-synced state even while a newer complete payload exists.
- Richard's reported Gozsdu inversion is present in live data. The 13:39 sync recorded large changes as `previo_external` (for example Studio €189 → €288 and €246 → €401), not as pending Hotel Care drafts. Gozsdu and Memories currently have no failed or pending drafts.
- All sellable Gozsdu/Memories room types currently have exact Previo mappings, but the publisher still has an unsafe fallback: if any future mapping is missing, it silently sends that room's draft through another room type's default mapping.
- Room hierarchy is not configured or enforced: all current derivation rows are `absolute / 0`, so Studio can exceed One-Bedroom and Single can exceed Double without a guard.

## Implementation

### 1. Make SLNT load the same complete cached dataset as RD

- Harden `get_revenue_published_payload` as a security-definer RPC with a fixed search path and an explicit `user_can_access_hotel(auth.uid(), _hotel_id)` check before returning data.
- Keep the base table RLS and authenticated-only access unchanged; no anonymous or cross-organization access will be added.
- Make the displayed freshness timestamp come from the exact published payload being rendered. Background sync state will only add an “updating” indicator and will never replace a valid payload timestamp with “never synced”.
- Increase the client timeout for the already-retried published-payload request so SLNT's ~5 MB response is not abandoned at 15 seconds on slower mobile connections, while keeping bounded retries and stale-response rejection.
- Preserve the last complete payload during background refreshes and transient failures; only show the non-numeric error state when no completed payload is available.

### 2. Give SLNT top management the same Revenue UI as RD admins

- Replace `profile.role === "admin"` presentation gates in `RevenueHotelDetail` with the existing `isRevenueAdmin(profile.role)` helper for Revenue tabs, calendar controls, reference-price context and operational tools.
- Keep portfolio-level organization administration admin-only and keep all existing backend authorization checks.
- Remove the forced grid-only experience for top-management roles so SLNT executives receive the same tab order and the same top-positioned Rate & Pickup calendar as equivalent RD Revenue users.

### 3. Stop cross-room price writes

- Remove the default room-type fallback in `revenue-push-drafts`: every draft must resolve an exact hotel/account/Previo room-type mapping or fail clearly before any write is sent.
- Apply the same exact-mapping rule to the remaining legacy rate-push path so no manual, bulk or automated operation can write a Studio price to a One-Bedroom/Double mapping.
- Keep multi-account identifiers scoped to their Previo account, preserving SLNT isolation.

### 4. Add a room-hierarchy safety guard for Gozsdu and Memories

- Define the sellable room hierarchy from the existing room-type order, excluding non-room products such as brunch, visitor centre and conference room.
- Before enqueueing or publishing a manual/bulk/automation change, validate that the resulting occupancy-level prices remain monotonic through that hierarchy (for example Single ≤ Double and Studio ≤ One-Bedroom).
- Block only the conflicting cells and return a specific explanation naming both room types and prices; do not silently rewrite a manager's requested rate.
- Run the same validation in automation so independent pickup moves cannot create a new inversion.
- Report existing Previo-origin inversions as external discrepancies instead of attributing them to Hotel Care; do not automatically overwrite current Previo prices without an authorized user action.

### 5. Verification

- Sign in as an SLNT `top_management_manager`, hard-reload `/slnt/revenue/slnt-group`, and confirm the cached dataset opens in seconds with its real “data from” time and no refresh loop, 403, or “never synced” flash.
- Compare SLNT and RD Revenue pages at the same role: identical tabs, ordering, Rate & Pickup calendar position, tools and loading behavior.
- Verify an SLNT user cannot request any RD payload and an RD user cannot request the SLNT payload.
- Test exact mappings for both SLNT Previo accounts and all sellable Gozsdu/Memories room types; verify an unmapped draft fails without sending anything.
- Test Studio/One-Bedroom and Single/Double inversions for manual, bulk and automation paths, plus valid edits that preserve hierarchy.
- Confirm existing external anomalies remain visible in audit history with their true `previo_external` source.

## Scope and isolation

The access fix validates the requested hotel against the signed-in user, UI changes use the existing Revenue role policy, and pricing checks are hotel-scoped. No data is copied between `slnt` and `rdhotels`, and no housekeeping or PMS-upload behavior is changed.
