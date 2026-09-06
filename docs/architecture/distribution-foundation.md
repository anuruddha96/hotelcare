# HotelCare Distribution Foundation

## Objective

HotelCare becomes the source of truth for hotel operations, revenue decisions and distribution intent while external PMS/channel/OTA systems are treated as connectors.

The foundation must support two routes to the same OTA:

1. **Aggregator route** — HotelCare -> Channex (or another approved connectivity provider) -> OTA.
2. **Direct route** — HotelCare -> OTA certified API.

The Revenue UI and AI assistant must not care which route is active. A hotel can migrate one OTA at a time from aggregator connectivity to a direct adapter without rewriting the HotelCare calendar or revenue engine.

## Layers

### 1. Canonical HotelCare model

Provider-neutral entities:

- Hotel/property
- Room type
- Rate plan
- Availability, rate, inventory and restrictions (ARI)
- Reservation
- Property/room content
- Photos
- Promotions
- Channel connection and mappings

The TypeScript contract lives under `src/integrations/distribution/`.

### 2. Secure connection layer

`distribution_connections` stores connection metadata and a `secret_ref` only. API keys, passwords and tokens must remain in server-side secret storage.

All distribution persistence starts with RLS enabled and no browser policies. Reads/writes must initially go through authenticated server/Edge Function actions that re-check the user's role and hotel access.

### 3. Mapping layer

Every HotelCare room type and rate plan is mapped to the corresponding external OTA/provider identifier. HotelCare IDs remain stable when the route changes from an aggregator to a direct OTA integration.

### 4. Change-set / approval layer

Every external write becomes a change set containing one or more items.

Sources:

- manual manager action
- revenue engine
- HotelCare AI agent
- PMS sync
- system process

Flow:

`draft -> pending_approval -> approved -> executing -> succeeded/partial/failed`

This is the safety boundary for future natural-language commands. The AI creates the same kind of change set as the Revenue UI; it does not bypass permissions or call OTA APIs with unrestricted credentials.

Every executable item has an idempotency key, attempt count, result state and redacted provider response. Every state transition is auditable.

### 5. Adapter layer

Each connectivity provider implements the same `DistributionAdapter` contract and declares supported capabilities.

Required/optional actions include:

- health check
- push ARI
- pull/acknowledge reservations
- update property content
- update room content
- update photos
- create/update/activate/deactivate promotions

Unsupported actions must fail explicitly at capability validation rather than being silently ignored.

### 6. Revenue integration

Current Revenue/Previo publishing remains operational during migration.

Target flow:

`Revenue decision -> canonical ARI change set -> approval/safety -> Distribution Core -> active provider adapter -> OTA`

The current Previo publishing route can become one adapter/route while new OTA routes are added. This lets HotelCare add direct channel publishing without breaking existing hotels.

### 7. AI action layer

The existing HotelCare assistant already follows a confirm-then-execute pattern for sensitive actions. Distribution actions should be added to the same pattern:

1. understand instruction
2. resolve hotel/channel/room/rate/date
3. read current source-of-truth state
4. build a preview change set
5. show exact proposed impact
6. user approves where required
7. server re-validates permissions/current state
8. execute through adapter
9. record audit/result
10. show confirmed provider outcome

Example future instruction:

> Increase the Standard Double Room by EUR 8 on Booking.com and Expedia for 10-12 September, but do not change Agoda.

The assistant should produce separate channel items under one change set and never infer an unmapped room/rate plan.

## Immediate implementation phases

### Phase 1 — Foundation (started)

- Canonical TypeScript distribution model
- Adapter interface and registry
- ARI validation + tests
- Secure persistence model
- Change-set, idempotency and audit model

### Phase 2 — Connection management

- Server endpoints to create/read/test connections
- Manager-only HotelCare Connections UI
- Capability discovery and health status
- Room/rate mapping UI
- Secret setup instructions

### Phase 3 — First live distribution provider

- Implement Channex adapter (recommended first launch route)
- Property/channel connection workflow
- Room/rate mapping sync
- ARI publish
- Reservation pull/webhooks
- Reconciliation and retry handling

### Phase 4 — Revenue calendar routing

- Add target channels to HotelCare Revenue calendar
- Preview per-channel effective price
- Route selected ARI changes through Distribution Core
- Preserve current Previo route for hotels not migrated

### Phase 5 — OTA content and promotions

- Canonical property facility taxonomy
- Room content + image library
- Provider capability matrix
- Content diff/preview
- Promotion model and provider adapters
- Explicit fallback to OTA extranet when an API does not support a requested field

### Phase 6 — Finance/Hungary

- Számlázz.hu connection and invoice actions
- PMS/folio/invoice state integration
- NTAK and VIZA workstream for eventual full-PMS replacement

### Phase 7 — Direct OTA adapters

Pursue direct certified integrations channel-by-channel without changing the upper layers. Aggregator connections can be retained as fallback or migrated per property/channel.

## Rules

1. HotelCare is the source of truth for internal IDs and intended state.
2. No OTA/PMS raw secrets in browser code or normal database columns.
3. No direct AI-to-OTA unrestricted access.
4. Every write is permission-checked, validated, idempotent and audited.
5. A failed channel must not silently block successful independent channels.
6. Never guess room/rate mappings.
7. Provider responses stored in logs must be redacted.
8. Unsupported API capabilities must be visible to managers.
9. Existing Previo hotels continue working during migration.
10. Marketing must distinguish live integrations from early-access/roadmap capabilities.
