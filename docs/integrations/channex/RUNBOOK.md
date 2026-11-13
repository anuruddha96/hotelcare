# HotelCare × Channex channel manager — runbook

Status (13 November 2026): code complete for **staging**. Not deployed, not certified, no customer hotel connected.
Read with `SKILL_REVIEW.md` (design decisions) and `STAGING_READINESS.md` (official doc links).

## What it does
- **Out (ARI):** HotelCare availability (sellable rooms per room type minus active bookings) and revenue-engine
  prices go to Channex as compressed date-range deltas. Channex distributes them to Booking.com, Expedia, Airbnb,
  Szallas.hu and the other OTAs connected in the Channex extranet.
- **In (bookings):** every OTA booking, change and cancellation arrives as a Channex booking revision and lands in
  HotelCare `reservations` (`source = 'channex'`), with the guest record, OTA name, OTA reservation code and the
  OTA's tax lines kept for reference.

## Pieces
| Piece | Purpose |
|---|---|
| `supabase/migrations/20261113150000_channex_channel_manager.sql` | Tables, safety gates, triggers, booking apply function, PII purge, Vault secrets, cron |
| `channex-admin` | Only browser entry point. Re-checks JWT, hotel access and role on every action |
| `channex-webhook` | Channex → HotelCare notifications; stores the revision before answering, then pulls it |
| `channex-booking-worker` | Every 5 min: per-property feed, retries, ACK recovery, lag alerts |
| `channex-ari-worker` | Every minute while there is work: debounce, plan, send in strict order, rate-limit |
| `src/components/channel-manager/*` | Channel Manager → "HotelCare Channel Manager · Channex" panel |

## Safety model
- Each hotel starts **off**. **Dry run** records what would be sent and stores bookings without applying them.
- **Staging + live** is only possible on a hotel flagged as a sandbox (database constraint).
- **Production + live** is blocked by the database until NTAK path, VIZA, tax, DPA and single-publisher
  confirmations, Channex certification (super admin) and owner approval are all recorded.
- **Kill switch** stops all outbound ARI at once and blocks queued snapshots; releasing it queues a fresh full sync.
- Bookings are ACKed to Channex **only** after the reservation or a review case is saved. OTA modifications are
  never auto-applied: they become review cases for front office. Unknown properties are never ACKed.
- No card data is stored. Raw OTA payloads lose guest data 90 days after departure.
- Provider property lists and arbitrary property UUID linking are not exposed to hotel managers (super admin only).

## One-time deployment (admin)
1. Review and merge the PR. Apply the migration (it creates two Vault secrets and three cron jobs; the jobs are idle
   until a hotel is connected).
2. Create a staging organisation and API key at https://staging.channex.io and set the edge function secret
   `HOTELCARE_CHANNEX_API` (set on 13 Nov 2026; `CHANNEX_STAGING_API_KEY` is also accepted) (Supabase dashboard → Edge Functions → Secrets). Never paste it in chat, issues or code.
3. Deploy `channex-admin`, `channex-webhook`, `channex-booking-worker`, `channex-ari-worker`
   (`config.toml` already sets `verify_jwt`).
4. Production later: `CHANNEX_PRODUCTION_API_KEY`, only after certification and commercial/DPA terms.

## Staging test and certification (one sandbox hotel)
1. Mark a dedicated test hotel as sandbox (owner role) in Setup → step 1, environment Staging, currency EUR.
2. Steps 2–5: test connection, create property, sync room types (creates room types + "Standard" rate plans),
   register webhook.
3. Dry run → check Activity shows the full-sync messages. Then Go live (staging, sandbox only).
4. In the Channex staging extranet connect the shared Booking.com test property (see Channex test-account guide),
   map it to the rate plans, keep it inactive until mapping is checked, then activate.
5. Run the official PMS certification cases (https://docs.channex.io/api-v.1-documentation/pms-certification-tests):
   full sync (500 days, 2 calls), single-date and range rate/restriction updates, availability updates, and booking
   create / modify / cancel via the Booking CRS app. Record screenshots and Channex task ids from Activity.
6. Use **Verify next 30 days** after each case. Simulate an outage (switch the webhook off, wait > 30 min) and use
   **Recover bookings**.
7. Super admin records certification only after Channex confirms it.

## Hungarian compliance (production gate)
- **NTAK:** every booking must reach the hotel's NTAK-registered accommodation software, which reports it.
  If Previo remains the registered software (`previo_receives_bookings`), OTA bookings received through Channex
  must be created in Previo. **This is not built yet:** `previo-reservation-writeback` currently sends only
  check-in/check-out. So for today's Previo hotels, production needs either (a) a Previo reservation-create
  write-back for `source = 'channex'`, or (b) HotelCare registered as the hotel's NTAK accommodation software.
  Do not tick the NTAK option until one of these is true.
- **VIZA:** guest ID data is captured with the document reader at check-in and sent through the registered
  software. OTA data is never used for VIZA. The guest record created from an OTA booking says so.
- **Tax and invoicing:** 5% VAT on accommodation, the municipal tourist tax (IFA) and the tourism development
  contribution (TFH) are calculated by invoicing. OTA tax lines are informational only. TFH rates changed in 2026;
  confirm current rates with the accountant rather than hard-coding them.
- **GDPR:** Art. 28 DPA with Channex; data minimisation (name, e-mail, phone, country only); card data dropped
  before storage; 90-day payload purge; guest data visible only to PMS roles of the same hotel.
- **Single publisher:** disconnect OTA channels from Previo/YieldPlanet before going live, so only one system
  publishes rates and availability.
- Consumer price display (gross prices incl. VAT, tourist tax shown separately) is configured per OTA in the
  OTA extranets.

## Daily operations
- Panel health strip: feed age, last push, oldest unacknowledged booking, open review cases.
- Un-ACKed > 10 min → warning in audit; > 25 min → urgent banner. After 30 min run **Recover bookings**.
- Review cases: front office applies the OTA change by hand, writes a note, marks resolved.
- Full sync is limited to once per 24 h (Channex guidance); deltas do the normal work.

## Rollback
1. Kill switch (stops ARI instantly) or set mode Off (stops ARI and booking application).
2. Re-enable OTA channels in Previo if it was the previous publisher.
3. Bookings already received stay in HotelCare; nothing is deleted.

## Known limits / still to verify on staging
- Official docs could not be re-fetched while building (13 Nov 2026). Re-check against current docs:
  webhook custom `headers` support (if unsupported, bookings still arrive via the 5-minute feed),
  rate limits, and HUF minor-unit handling in Channex.
- One per-room rate plan per room type at the hotel's priced occupancy. Per-person pricing and extra rate plans
  (non-refundable, breakfast) are a follow-up.
- Availability counts bookings by room type name; a booking for an unmapped room type opens a review case and
  does not reduce availability until it is assigned.
- OTA channel connection/mapping happens in the Channex extranet (Channel API access is whitelabel-gated).
