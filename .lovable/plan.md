# SLNT Group onboarding — architecture assessment

Assessment only. No code or database changes are proposed for immediate execution; section 9 is the phased plan for later approval.

## 1. Tenant isolation model today (and its weaknesses)

- `organizations` (rows: `hotelcare`, `rdhotels`, `slnt`) → `hotel_configurations` (`hotel_id` slug + `hotel_name` display + `organization_id`). SLNT already exists with two hotels: `demo`, `slnt-group`.
- Org is resolved from the **URL**, not the profile: `src/App.tsx` passes `:organizationSlug` into `TenantProvider` (`src/contexts/TenantContext.tsx:47-83`), with an RPC fallback `get_user_organization_hotels()`.
- The real per-record boundary is **two free-text columns**: `profiles.assigned_hotel` (text, nullable, no FK) and `rooms.hotel` / `tickets.hotel` etc. plus `organization_slug` stamped on rows.

Weaknesses:
- `rooms.hotel` mixes slugs and display names in live data (`previo-test`, `Hotel Memories Budapest`, `Hotel Ottofiori`, `hotelcare-test`, `788619`). `src/lib/hotelKeys.ts` (`resolveHotelKeys`) papers over this, but only ~half of ~35 hotel-filtering call sites use it; the rest do bare `.eq('hotel', profile.assigned_hotel)` (e.g. `SimpleRoomAssignment.tsx:57`, `RoomAssignmentDialog.tsx:98`, `SupervisorApprovalView.tsx:384`, `MinibarTrackingView.tsx:574`).
- RLS uses *exact* equality while the client uses alias resolution — two different notions of "same hotel".
- `rooms` policy `Users can view rooms based on role and assignment` ends with `OR profiles.role = 'housekeeping'` — **any housekeeper can read every room in their organization**. Acceptable at 21–71 rooms/one hotel; not acceptable for SLNT's ~60 units across many venues with per-supervisor scoping.
- `normalize_hotel_name()` uses bidirectional `ILIKE '%…%'` — substring collisions are a real risk once SLNT adds many similarly-named venues.
- Hardcoded `|| 'rdhotels'` org fallback in ~20 files (`useAuth.tsx:70`, `Index.tsx:75,83,95`, `AutoRoomAssignment.tsx:333`, `create-housekeeper`, `guest-minibar-submit`, `previo-pull-revenue`, …) — a SLNT user with a missing `organization_slug` silently falls into RD Hotels.

## 2. Property/room hierarchy

Two levels only: `hotel_configurations` → `rooms` (`hotel` text, `floor_number`, `wing`, `room_type`). There is **no venue/address level**. `hotel_floor_layouts` (queried by `hotel_name` in `AutoRoomAssignment.tsx:312`) and `rooms.wing` are the closest existing grouping primitives.

## 3. Roles and scope

- `user_role` enum has 20 values; **there is no `supervisor` value**. "Supervisor" is a screen name (`SupervisorApprovalView`) available to manager-tier roles, scoped to their one `assigned_hotel`.
- `src/lib/roleAccess.ts` is a pure role→capability map with no scope concept.
- `department_access_config.access_scope` supports `hotel_only | all_hotels | assigned_and_created` — **per role, not per user**, and has no `organization_id`, so it is global across tenants.
- **No user can be scoped to a subset of properties.** `assigned_hotel` is one string; everything else is all-or-one. This is the single biggest gap for SLNT's requested model.

## 4. PMS assumptions and two Previo accounts

- Credentials resolve per `pms_configurations.hotel_id` → `credentials_secret_name` → Deno env secret (`_shared/previoCredentials.ts:163-177`), with `pms_hotel_id` as the Previo-side id. `UNIQUE(hotel_id, pms_type)`.
- **Two Previo accounts under one organization already work** — they just require two `hotel_configurations` rows. RD Hotels does this today (`ottofiori` → `PREVIO_CREDS_OTTOFIORI`, `previo-test` → `PREVIO_HOTEL_TEST`). One `hotel_id` cannot hold two accounts.
- Legacy global fallback `PREVIO_API_USERNAME/PASSWORD` in `_shared/previoAuth.ts:160-174` ("OttoFiori only") is a cross-tenant hazard: an SLNT hotel with a misconfigured secret name could fall back to RD credentials.
- `_shared/roomCode.ts` hardcodes room-code parsing per hotel id (`memories-budapest`, `mika-downtown`, `ottofiori`, `gozsdu-court`) with a generic fallback — SLNT will need its own rule.
- `supabase/functions/slnt-pms-sync/index.ts` is a stub already gated to `orgSlug === 'slnt'` and currently `manual_only`/`not_configured`.

## 5. Housekeeping coupling points

`AutoRoomAssignment.tsx:246-360` derives everything from `profile.assigned_hotel` (bails if unset), then filters staff by `.in('assigned_hotel', keys) + organization_slug`, rooms by `.in('hotel', keys)`, layouts by `.eq('hotel_name', hotelName)`, patterns by `.eq('organization_slug', … || 'rdhotels')`. `roomAssignmentAlgorithm.ts:62-90,360` hardcodes `MEMORIES_ZONES` and `hotelName === 'Hotel Memories Budapest'`. `room_assignments` rows carry `organization_slug` but **no hotel/venue column** — hotel scope is inferred through `room_id`.

## 6. Recommended data model for SLNT (additive only)

```text
organizations (slnt)
  └── pms_accounts        NEW: one row per Previo account (2 for SLNT)
        └── hotel_configurations  = "portfolio" row per Previo account
              └── venues     NEW: address/building (name, address, hotel_id FK)
                    └── rooms  (+ venue_id nullable FK)   = units
user_property_scopes       NEW: (user_id, venue_id) many-to-many
```

Key choices:
- Keep `hotel_configurations` as the PMS-account boundary (2 SLNT rows) so the existing per-hotel credential resolution keeps working untouched.
- `venues` is the new grouping layer; `rooms.venue_id` is **nullable**, so RD Hotels rows stay `NULL` and every existing query behaves identically.
- `user_property_scopes` is additive; scope checks must be written as "no scope rows ⇒ current behaviour", so RD users are unaffected.
- Add a real `supervisor` role value (enum append is safe) plus `has_venue_access(user_id, venue_id)` as a SECURITY DEFINER function, mirroring the existing `has_role` pattern.
- Long-term rentals: model as a unit attribute (`rooms.room_category`/`pms_metadata`), not a separate hierarchy.

## 7. Feature flags vs fork

Flags/settings — not a fork. The codebase already does this well (`src/lib/propertyTerminology.ts` `PROPERTY_ORG_SLUGS`, `hotel_autoassign_profiles` per hotel, org-gated `slnt-pms-sync`). Recommend consolidating into `organizations.settings` / `organization_settings` keys such as `venues_enabled`, `scoped_supervisors_enabled`, `terminology: 'property'`, `housekeeping_only: true`, read once via `TenantContext`. A fork would double the maintenance of every housekeeping screen.

## 8. High-risk areas for RD Hotels / Ottofiori

1. Editing shared RLS policies on `rooms` / `room_assignments` / `profiles` — must add venue predicates as `venue_id IS NULL OR …`.
2. Removing the `OR profiles.role = 'housekeeping'` clause on `rooms` — needed for SLNT, would restrict RD housekeepers. Gate by org.
3. Changing `resolveHotelKeys` / `normalize_hotel_name` semantics — touches every hotel query.
4. The `|| 'rdhotels'` fallbacks — an SLNT user with a null `organization_slug` writes into RD's namespace.
5. The `previoAuth.ts` global credential fallback.
6. `department_access_config` — global, has no org column; changing rows changes RD behaviour.
7. Auto-assign shared code paths and `assignment_patterns` (org-slug default).
8. `_shared/roomCode.ts` generic fallback branch.
9. Enum/type churn in `src/integrations/supabase/types.ts` affecting all screens.

## 9. Phased plan (each phase independently shippable)

1. **Guardrails first (no SLNT features):** replace `'rdhotels'` fallbacks with the resolved tenant slug; remove the `previoAuth` global fallback; add a read-only drift audit for `rooms.hotel` vs `hotel_configurations`.
2. **Tenant settings layer:** org-level flags in `organizations.settings`, surfaced by `TenantContext`; no behaviour change for RD.
3. **Venue model:** `venues` table + nullable `rooms.venue_id`; admin UI to create SLNT venues and bulk-assign units. RD untouched (all NULL).
4. **Supervisor role + scopes:** append `supervisor` to `user_role`, add `user_property_scopes` + `has_venue_access()`, extend RLS with `NULL`-safe predicates, add scope UI in user management.
5. **Housekeeping venue awareness:** venue grouping/filter in Team View, Auto-Assign, Supervisor Approval — rendered only when `venues_enabled`.
6. **SLNT PMS:** two `hotel_configurations` + two `pms_configurations` rows with distinct secrets; finish `slnt-pms-sync`; add an SLNT branch in `roomCode.ts`.
7. **Trim modules for SLNT:** hide Revenue/Breakfast/Minibar/PMS-upload via flags; housekeeping-first landing.
8. **Pilot:** one SLNT venue live, then the full ~60 units.

## 10. Acceptance tests before enabling SLNT

Regression (must be unchanged): RD manager sees the same room counts on Team View and Auto-Assign; RD housekeeper sees the same tasks; Ottofiori PMS sync and revenue sync succeed with unchanged row counts; RD supervisor approval queue unchanged; RD auto-assign output identical for the same input day.

New SLNT behaviour: top management sees all SLNT venues/units and no RD data; ops manager sees all SLNT venues grouped by address and can assign across them; supervisor A sees only venue A units and cannot read venue B via direct API call (verified against PostgREST, not just UI); housekeeper sees only their own assigned units; both Previo accounts sync into their own portfolio with no credential bleed; a SLNT user with a null `organization_slug` is rejected rather than defaulting to RD; cross-org negative test — an RD token querying SLNT rooms returns zero rows.

## Open items to confirm

- Are SLNT's two Previo accounts split by venue group, or is one for short-term and one for long-term stock?
- Should supervisors be scoped to venues only, or also to individual units?
- Should `demo` and `slnt-group` become the two PMS-account rows, or should new ones be created?
