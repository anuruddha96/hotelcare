# Channex PMS certification — runbook (HotelCare)

Status 13 Nov 2026: combined build (channel manager foundation + native rates & availability) ready for **staging**.
Architecture and safety model: `RUNBOOK.md`. This file is the step-by-step for the certification itself.

## Pieces
| Requirement (Channex) | Where it lives |
|---|---|
| Changes detected as they happen | `pms_ari_rates` / `pms_ari_availability` triggers → `channex_rate_changes` / `channex_availability_dirty`; reservation trigger `tr_reservations_channex_availability` |
| Queue / outbox, batching | `channex-ari-worker`: 20 s debounce, field-level merge, range compression, one message per kind (`channex_ari_outbox`) |
| 10 req/min/property | `callsAllowedNow` (max 9 per minute, 5 per run), strict order per kind |
| Retry/backoff on 429/5xx | `ChannexError.retryable`, 30 s → 30 min, 8 attempts, then `failed` + connection error |
| Webhook + ACK | `channex-webhook` (secret header, registered automatically in Setup step 5) → `channex-booking-worker` → `channex_apply_revision` → ACK only after the reservation or a review case is saved |
| booking_revisions only | `GET /booking_revisions/feed`, `GET /booking_revisions/:id` |
| Mapping layer | `channex_mappings`: room type → Channex room type, **HotelCare rate plan → Channex rate plan** (native hotels have 2 per room type) |
| Full sync: 2 calls, 500 days | Queued on switching to dry run / live, or **Full sync** button (once per 24 h) |
| Property type + timezone | Set when the property is created (Setup step 3) |

Pre-flight answers for the live review:
- Where is `POST /availability` called? `supabase/functions/_shared/channex/client.ts` → `pushAvailability`, called from `channex-ari-worker/index.ts` `sendHotel`.
- What emits the change? **Reception → Rates & Availability → Save** calls `pms_ari_save()`; row triggers write the change signals. A reservation insert/update/cancel writes an availability signal.
- Without test code would it still work? Yes. Tests (`src/integrations/channex/*.test.ts`, `supabase/tests/channex_*.sql`) only exercise production code.

## Sandbox tenant
- Organization `channex`, hotel **Test Property - HotelCare** (`channex-test-property`), USD, Twin Room ×10, Double Room ×5,
  Best Available Rate 100 / Bed & Breakfast Rate 120 on each room type, rooms T101–T110 and D201–D205.
- Only hotels in organization `channex` with `settings.native_ari = true` use the native store. RD Hotels, SLNT and every Previo hotel are unchanged.

## Steps (Channel Manager → HotelCare Channel Manager · Channex → Setup)
1. **Connection settings**: environment Staging, currency **USD**, tick *sandbox / test hotel* (owner role).
2. **Channex API access**: should show the staging key as configured (`HOTELCARE_CHANNEX_API`).
3. **Channex property**: title `Test Property - HotelCare` → *Create property in Channex* (sets property type `hotel` and timezone `Europe/Budapest`).
4. **Room types and rate plans**: select both room types → *Sync*. Creates 2 room types and 4 rate plans and stores the mapping.
5. **Webhook**: *Register webhook*.
6. **Make the data realistic while the connection is still Off** (Channex rejects uniform data). In **Reception → Rates & Availability → Bulk update**:
   - Twin BAR 95, Twin B&B 115, Double BAR 110, Double B&B 130 for the next 500 days;
   - Fri + Sat +25; 20 Dec – 2 Jan and Apr – Oct higher; min stay 2 on summer Fri–Sat; a few stop-sell dates;
   - create 6–10 reservations at reception across the coming months.
7. **Dry run** → check Activity: two full-sync messages recorded, nothing sent. Then **Live** (type GO LIVE) → the full sync is sent: **test 1** (two task IDs in Activity, click to copy).
8. **Tests 2–8** in **Rates & Availability**: edit cells or add Bulk updates, **one Save per test** → one restrictions message (≈20–60 s later; task ID in Activity).
   Tests 3, 4 and 7: add all rows of the test before pressing Save. Test 5 "Min stay" = min stay arrival. Test 8: rate and restrictions in one Bulk update.
9. **Tests 9–10** (availability): set *Rooms to sell* (Twin 8 on 21 Nov 2027, Double 1 on 25 Nov 2027), Save, then create one reservation for each date at reception → Twin 7, Double 0 in one availability message. Test 10: Bulk update rooms to sell (Twin 3 for 10–16 Nov 2027, Double 4 for 17–24 Nov 2027), one Save.
10. **Test 11** (bookings): our Booking.com test accounts are used up; Channex accepts **Applications → Booking CRS → Bookings → Create**, then edit and cancel.
    New → reservation(s) created. Modified → applied automatically on sandbox hotels when the guest is not checked in (review case otherwise). Cancelled → reservation(s) cancelled. Each revision is acknowledged after it is saved; Activity shows "acknowledged".
11. Tests 12–14: answers below.

## Answers for the form
- **Rate limits**: yes. Outbox with debounce and strict ordering, max 9 requests/min per endpoint per property, exponential backoff on 429/5xx.
- **Update logic**: deltas only. Full sync only on go-live, kill-switch release or manual recovery (max once per 24 h).
- **Min stay**: both arrival and through.
- **Restrictions**: rate, min stay arrival, min stay through, max stay, closed to arrival, closed to departure, stop sell.
- **Multiple room types and rate plans per room type**: yes.
- **Credit cards**: not needed; card/guarantee data is stripped before storage. Not PCI certified; a PCI vault would be needed before storing cards.

## Verified before go-live (13 Nov 2026)
- Local Postgres 16, production order (foundation → sandbox → native): test 3 signals per rate plan, min-stay-only save keeps the rate, test 9 gives 7 / 0, full-sync source 2 000 rows (4 plans × 500 days), Previo hotel untouched; bookings: two rooms, sandbox modification, cancellation, change after check-in → review. Same checks run in CI (`supabase/tests/channex_native.sql`).
- Vitest: certification scenarios 3, 4, 7, 8 and the modification paths (`src/integrations/channex/certification.test.ts`).
- Not yet run against Channex staging: real responses, task IDs, webhook delivery and the exact Booking CRS payload.
