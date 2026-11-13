# Channex PMS certification — runbook (HotelCare)

Status: **phase 1 built, not yet deployed** (branch `feat/channex-certification-phase1`).
Scope: the isolated sandbox tenant only. RD Hotels, SLNT, the Previo test hotel and every live hotel are untouched.

## What exists after this PR

| Certification requirement | Where it lives |
|---|---|
| Detect ARI changes as they happen (no DB polling) | Row triggers `tr_pms_ari_rates_capture`, `tr_pms_ari_availability_capture`, `tr_pms_ari_reservation_changed` (migration `20261113161000`) |
| Queue / outbox that batches changes | `channex_ari_outbox` + `channex_enqueue_ari()` (merges repeated edits of a cell) |
| 1 API call per kind per save | `supabase/functions/_shared/channexAri.ts` (`coalesceOutbox`, `compressCells`) used by `channex-ari-worker` |
| Respect 10 req/min/property | `REQUESTS_PER_MINUTE_BUDGET = 8` checked against `channex_sync_log` before every send |
| Retry/backoff on 429 / 5xx | `classifyStatus` + `backoffSeconds` (15 s → 15 min, honours `Retry-After`); rows return to `pending` |
| Webhook + ACK flow | `channex-webhook` (shared-secret header) → `channex-booking-worker` → `channex_apply_booking_revision()` → `POST /booking_revisions/:id/ack` only after commit |
| Booking revisions, never `GET /bookings` | `GET /booking_revisions/feed` and `GET /booking_revisions/:id` only |
| Mapping layer | `channex_mappings` (room_type / rate_plan → Channex UUID), created by the **Create / check mapping** button |
| Full sync = 2 calls, 500 days | `channex-ari-worker` action `full_sync` |
| No timer full sync | The 1-minute cron only drains the outbox; with an empty outbox it sends nothing |
| Property type + timezone | Set on create; repaired by bootstrap if missing (`hotel`, `Europe/Budapest`) |

**Pre-flight answers (for the live review)**
- Where is `POST /availability` called? `supabase/functions/channex-ari-worker/index.ts`, function `drainKind` (deltas) and `fullSync`.
- What emits the change? Saving in **Rates & availability** calls `pms_ari_save()` → rows change → triggers enqueue. A reservation insert/update/cancel recomputes availability by trigger.
- If all test code were deleted, would it still work? Yes — there is no certification-only code; the tests in `src/integrations/channex/channexAri.test.ts` only exercise the production batcher.

## One-time setup (owner)

1. **Merge the PR**, then apply the two migrations in order (they are not applied automatically):
   `20261113160000_channex_sandbox_org_test_property.sql`, `20261113161000_channex_ari_outbox_and_bookings.sql`.
2. **Secret**: the staging API key must be in Supabase secrets as `HOTELCARE_CHANNEX_API` (already used by the October sandbox probe; check it is still set).
3. **Edge functions** deploy automatically ~4 minutes after merge: `channex-ari-worker`, `channex-booking-worker`, `channex-webhook`.
4. **User access**: give your account access to organization `channex` (super admin already sees it). Open `/channex/channel-manager` with hotel *Test Property - HotelCare* selected.
5. **Webhook in Channex staging**: Settings → Webhooks → new webhook
   - URL `https://pcmszqqklkolvvlabohq.supabase.co/functions/v1/channex-webhook`
   - events: booking (new / modification / cancellation)
   - custom header `x-hotelcare-webhook-secret` = value of vault secret `channex_webhook_secret`
     (`select decrypted_secret from vault.decrypted_secrets where name='channex_webhook_secret';`)
   - property: Test Property - HotelCare only.

## Running the certification (in the HotelCare UI)

Channel Manager → **Channex · staging** panel:
1. **Create / check mapping** → creates the Channex property *Test Property - HotelCare* (USD, hotel, Europe/Budapest), Twin/Double, 4 rate plans, and stores the mapping.
2. Make the property look like a real hotel **before** the full sync (Channex rejects uniform data). In **Rates & availability → Bulk update** (5 minutes):
   - Twin BAR 95, Twin B&B 115, Double BAR 110, Double B&B 130 for the whole 500 days;
   - Fri+Sat +25 on all plans; Dec 20–Jan 2 and Apr–Oct higher prices; min stay 2 on Fri–Sat in summer; stop sell on a few dates;
   - create 6–10 reservations at reception across the next months (availability then varies by day).
   Press **Save** once per block. These are real PMS actions; nothing is posted to Channex yet.
3. Switch on **Send rates & availability**, make sure **Emergency stop** is off, then **Full sync (500 days)** → test 1 (2 task IDs).
4. Tests 2–8: do them in **Rates & availability**. Edit cells or add Bulk updates, then **one Save per test** → one restrictions request. The task ID appears in the toast and in the panel's request table (click to copy).
   - Test 3, 4, 7: add all rows of the test (several plans/ranges) before pressing Save.
   - Test 5: field "Min stay" = `min_stay_arrival`.
   - Test 8: rate and restrictions in the same Bulk update → one call.
5. Tests 9–10: availability.
   - Test 9: set *Rooms to sell* Twin = 8 on 21 Nov 2027 and Double = 1 on 25 Nov 2027, Save. Then create one reservation at reception for each date → Twin 7, Double 0 go out in one availability request.
   - Test 10: set *Rooms to sell* with Bulk update (Twin 3 for 10–16 Nov 2027, Double 4 for 17–24 Nov 2027), one Save.
6. Test 11 (bookings): switch on **Receive bookings**.
   - Our Booking.com test accounts are used up (support asked to release one). **Alternative accepted by Channex:** Applications → install **Booking CRS** → Bookings → **Create**, then edit and cancel it. This unblocks test 11 without waiting for support.
   - Each revision is saved as a reservation (one per room), then acknowledged. Watch the **Bookings received** list; "acknowledged" must show for new, modified and cancelled.
7. Tests 12–14: answers below.

## Answers for the form (tests 12–14)

- **Rate limits**: yes. Outbox + per-property budget of 8 requests/min per endpoint, exponential backoff on 429/5xx, `Retry-After` honoured.
- **Update logic**: yes, deltas only. Full sync only on go-live or manual recovery; optional daily off-peak full sync is *not* scheduled.
- **Min stay**: we support both *arrival* (`min_stay_arrival`, default field) and *through* (`min_stay_through`, under "All restrictions").
- **Restrictions supported**: rate, min stay arrival, min stay through, max stay, closed to arrival, closed to departure, stop sell.
- **Multiple room types and rate plans per room type**: yes.
- **Credit card details**: not needed in phase 1; card/guarantee data is stripped before storage. Not PCI certified; a PCI vault (e.g. PCI Booking / Tokenex) would be required before storing cards.

## Mock certification (self-assessment, 2026-11-13)

| # | Test | Expected | HotelCare behaviour | Verified how |
|---|---|---|---|---|
| — | Property setup | type + timezone set | set on create / repaired by bootstrap | code review |
| 1 | Full sync | 2 calls, 500 days, realistic data | 1 availability + 1 restrictions call, compressed ranges | unit test `full sync` + code |
| 2 | Single date, single rate | 1 call | 1 value | unit test + local Postgres flow |
| 3 | Single date, 3 rates | 1 call | 3 values, 1 call | unit test + local Postgres flow |
| 4 | Ranges, 3 rates | 1 call | 3 ranges | unit test |
| 5 | Min stay | 1 call | `min_stay_arrival`, other fields preserved | local Postgres flow |
| 6 | Stop sell | 1 call | `stop_sell: true` | UI + batcher |
| 7 | Mixed restrictions | 1 call | only set fields sent | unit test |
| 8 | Half year | 1 call | 2 values (one per plan) | unit test |
| 9 | Availability by booking | 1–2 calls | Twin 7 / Double 0 in 1 call | local Postgres flow |
| 10 | Availability ranges | 1–2 calls | 2 ranges in 1 call | unit test |
| 11 | Booking new/modify/cancel + ACK | ACK each | apply → ACK after commit; idempotent; foreign property refused | local Postgres flow (apply); ACK path needs staging |
| 12 | Rate limits | queue | yes | code |
| 13 | Deltas only | yes | yes | code |

**Not yet verified against Channex staging** (needs the migrations applied + the API key): real HTTP responses, task IDs, booking ACK, webhook delivery, the exact booking revision field names (`booking_room_id`, `checkin_date`, `occupancy`) — the apply function has fallbacks but must be checked on the first real Booking CRS booking.
