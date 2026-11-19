# HotelCare × NTAK PMS interface v9 — runbook

Status (19 November 2026): code complete for the **NTAK test environment**. Not deployed, no NTAK test credentials
yet, not certified. Built against *NTAK PMS Interface v9.07* (Visit Hungary, 28-11-2025) and the five v9 WSDLs
published on <https://info.ntak.hu/segedletek> (files dated 2026-04).

## What it does
| Flow | NTAK operation | When |
|---|---|---|
| Daily closure | `napiZaras` | Manually from Reception (recommended) or automatically after a set time; one per day, corrections as `MODOSITO` |
| Advance bookings | `foglalasEsemeny` | Initial sync of all future arrivals (5 s apart), then every new/changed/cancelled booking |
| Stay events | `esemenyvezereltAdatkuldes` | Check-in, room change, check-out; undoing one sends the opposite event |
| Processing results | `ellenorzes` | 10 min after sending, then every 30 min (start-date query: every 5 min, 24 h) |
| Reporting start date | `adatszolgaltatasKezdoDatum` | On demand from the settings panel |

Every request is signed (WS-Security, exclusive C14N, rsa-sha384 by default; Body + Timestamp, BinarySecurityToken
with the universal certificate) and sent over mTLS with the same certificate. NTAK's synchronous faults and the
warnings/errors of the verification step are stored per message and shown to users (certification criterion 5.1.1).

## Pieces
| Piece | Purpose |
|---|---|
| `supabase/functions/_shared/ntak/` | Pure library: value sets, request builders (exact WSDL order), response parser, guest id, IFA, closure assembly + checklist, ledger mapping, WS-Security, CSR/X.509, transport |
| `supabase/functions/ntak-pms/` | Edge function: cron worker + UI actions (`index.ts`), data loading and the send/verify state machine (`engine.ts`) |
| `supabase/migrations/20261119100000_ntak_pms_v9.sql` | Settings, unit profiles, stay guests, guest ids, outbox, closure register, queues + triggers, Vault helpers, cron |
| `src/components/ntak/` | Reception card, trial closure dialog, settings panel (certificate, units, closures, NTAK messages) |
| `supabase/functions/_shared/ntak/testdata/ntak-v9.xsd` | The 77 schema definitions of the published WSDLs, consolidated (byte-identical apart from one documented deviation) |

## Safety model
- A hotel sends nothing until `ntak_settings.enabled` is on **and** identifiers, endpoint and certificate are set.
- Triggers on `reservations` only queue work and swallow their own errors: NTAK can never block the front desk.
- The trial closure lists every problem first; **errors block sending** (NTAK would reject them), warnings do not.
- Certificate or registration errors (`ElteresCNadatok`, `NemTalalhatoPms`, `AdatszolgaltatasTiltva`, expired/revoked
  certificate, TLS rejection) stop all sending for the hotel until a manager resumes it (spec 6.1.4).
- Retries only for server errors: after 1, 10 and 60 minutes, then the message is marked failed (spec 7.5).
- Rate limit: at most 900 messages per hotel per hour (NTAK warns above 1000, suspends above 2000).
- Private keys, certificates and the guest-id salt are in Vault, readable only by the service role. The salt never
  leaves HotelCare (spec 9.1.1). Guest ids are generated once and reused even if the guest's data is corrected (9.1.3).

## One-time deployment (admin)
1. Review and merge the PR, apply the migration (adds tables, triggers on `reservations`, one cron job that is idle
   while no hotel is enabled), deploy `ntak-pms` (`verify_jwt = false` is set in `config.toml`; the function checks
   the worker secret or the user's JWT itself).
2. Edge function secrets (Supabase dashboard → Edge Functions → Secrets):
   - `NTAK_SOFTWARE_ID` — HotelCare's NTAK software id, once NTAK assigns it (can also be set per hotel).
   - `NTAK_EGRESS_PROXY_URL`, `NTAK_EGRESS_PROXY_USER`, `NTAK_EGRESS_PROXY_PASSWORD` — see *Fixed IP*.
3. Fixed IP for the NTAK whitelist (questionnaire field): Supabase Edge Functions have no static egress IP. Run a
   small VM with a static IP (any EU cloud provider; the smallest instance is enough) with an HTTP CONNECT proxy
   restricted to the NTAK hosts on port 443 and protected with a password, e.g. tinyproxy:
   ```
   Port 8888
   BasicAuth hotelcare <long-random-password>
   ConnectPort 443
   Filter "/etc/tinyproxy/ntak-hosts"   # one line per NTAK host given with the test access
   FilterDefaultDeny Yes
   ```
   TLS stays end-to-end through the tunnel (the proxy never sees the key or the data). Put the VM's IP in the NTAK
   questionnaire and in the VIZA/THF request too: VIZA uses the same certificate and the same egress need.

## Per-hotel setup (Reception → NTAK card → NTAK settings)
1. **Settings**: NTAK registration number (SZ…), provider tax number, data-reporting id, rooms/beds as registered,
   accommodation class and region (extreme-value limits), tourism tax type/rate (check the municipality on
   <https://szallas.ntak.hu/public/onkormanyzat-ifa-info>), accommodation VAT (default 5 %, the band of
   szálláshely-szolgáltatás; confirm with the accountant), environment `test`, endpoint URL from NTAK, `first_closure_date`, and for a switch from Previo the
   last day Previo closed (`software_change_date`).
2. **Units**: *Create profiles from rooms*, then check building, NTAK unit type and permanent single/double beds for
   every room; the active count must equal the NTAK registration. Map room types for unassigned future bookings.
3. **Certificate**: *Generate CSR* (RSA 4096, SHA-256, clientAuth, fresh key each time) → download → upload on the
   NTAK portal → when NTAK emails, download the certificate and paste it in *Upload certificate*. A CSR made
   outside HotelCare works too: paste the private key with the certificate (PKCS#1 or PKCS#8, unencrypted).
4. **Self-test** (nothing is sent): identifiers, Vault, key/certificate match, signature, mTLS support, proxy, units.
5. **Ask NTAK for the reporting start date**, **enable**, then **Send all future bookings**.

## Integration test plan (NTAK test environment)
Use a test hotel with the NTAK test registration number and test certificate. Each step must end `TELJESEN_SIKERES`
(or the expected warning) in *NTAK settings → Messages*.
1. Connectivity + signature: start-date query → verified, date shown.
2. Advance bookings: new direct booking, OTA booking (2 rooms), modification (dates, guests), cancellation, booking
   with unknown country (`EGYEBKULFOLDI`, see *Open points*).
3. Events: check-in with 2 guests, room change, check-out, undo a check-in (sends `tavozott`), undo a check-out.
4. Daily closures (trial first, then send):
   - normal day: guests of several nationalities, percentage IFA, an under-18 guest (im1), advance payment reported
     on arrival day, card + cash + SZÉP card payments, minibar charge, package breakfast (if configured);
   - check-out day sales (breakfast/minibar on departure day), post-departure charge and payment;
   - an out-of-order room, a day-use stay, a closed day (`szallashelyNemUzemel`);
   - correction of an accepted day (`MODOSITO` with record id + reason) and an expected rejection (e.g. second `UJ`)
     to show that NTAK errors are displayed.
5. Certificate behaviour: upload an expired/foreign certificate (rejected locally); NTAK certificate error → sending
   stops and Reception shows it.
6. Initial sync spacing (≥ 5 s) and the hourly limit (logic covered by tests).

## Go-live
- Production endpoint + production certificate, environment `production`, `first_closure_date`, closure mode.
- **Switching from Previo** (NTAK guide: <https://info.ntak.hu/storage/media/2026/08/szallashelykezelo-szoftvervaltas-folyamata-1786142843.pdf>):
  select HotelCare as the software on the NTAK portal, request the certificate for HotelCare, set
  `software_change_date` = last day Previo closed (days up to it are re-sent only as `MODOSITO`, spec 9.2.20),
  turn Previo's NTAK reporting off the same day, then run the initial booking sync. Bookings Previo already sent
  get HotelCare booking numbers (Channex booking id → Previo reservation id → HotelCare reservation number).
- First week: check every morning that yesterday is *Accepted* and no day is listed as missing.

## Open points to confirm
- **Companions**: NTAK (and VIZA) need every guest. `reservation_guests` now stores all stay guests (the booker is
  added automatically); the check-in screen still needs a step to add companions. Until then the checklist warns
  when fewer guests are registered than adults + children, and a room with no complete guest blocks the closure.
- `EGYEBKULFOLDI`: required by the interface description (8.1.1) but not in the 2026-04 WSDL pattern; switch the
  hotel setting to `EGYEB` if the test environment rejects it.
- Accommodation VAT (5 % default) and IFA lines sent with VAT 0 (tourism tax is outside VAT; the spec example
  shows 27, configurable). Per-category mapping (`ledger_config`: minibar defaults to EGYEB/EGYEB,
  restaurant to ETEL/EGYEB, bar to ALKOHOLOSITAL/ITALCSOMAG, spa to KOZFURDO/WELLNESS_PROGRAM).
- Package items (e.g. breakfast in the rate) must be configured in `ledger_config.packageComponents` so the
  accommodation fee excludes them (spec 8.4). Folios in EUR need `ledger_config.fxRates.EUR`.
- Revenue not linked to rooms (walk-in restaurant, spa day guests) is not fed yet (`egyebTerhelesek/egyebKoltesek`).
- Out-of-order states are known only for today/yesterday; older closures report every unit available (warning).
- `garantaltFoglalas` is sent as nil (unknown); `Deno.createHttpClient` (mTLS) must be confirmed on the deployed
  edge runtime — the self-test shows it.

## Troubleshooting
| NTAK answer | Meaning / action |
|---|---|
| `FAILED_CHECK` | Signature rejected: try `signature_profile` rsa-sha256, check the certificate is the one NTAK issued |
| `ErvenytelenIdobelyeg` | Arrived > 300 s after the timestamp: check server clock / proxy delay |
| `ElteresCNadatok`, `ElteroKuldorendszer`, `NemTalalhatoPms` | Registration number, software id or certificate mismatch on the NTAK portal; sending stops |
| `KotelezoSzallasdij`, `ErvenytelenIfa`, `IfaTerhelesHianya` | Accommodation fee / tourism tax data of the day: fix and send a correction |
| `ElteresRegisztraltAdatokban` | Room or bed totals differ from the NTAK registration (warning) |
| `MarLetezoUjZaras` / `ErvenytelenModositoZaras` | UJ/MODOSITO mismatch; HotelCare picks it from the register, check `software_change_date` |
| `AdatszolgaltatasTiltva` | NTAK suspended the hotel (too many messages?): contact NTAK support |
All keys with explanations: `ERROR_KEYS` in `_shared/ntak/codes.ts`.

## Tests
```
deno test --node-modules-dir=auto --allow-read --allow-write --allow-run --allow-env supabase/functions/_shared/ntak/ntak_test.ts
deno test --node-modules-dir=auto --allow-read --allow-write --allow-run --allow-env --allow-net supabase/functions/ntak-pms/engine_test.ts
psql -f supabase/tests/ntak_fixture.sql -f supabase/migrations/20261119100000_ntak_pms_v9.sql -f supabase/tests/ntak_integration.sql
bunx vitest run src/components/ntak
```
They cover: the spec's guest-id example, IFA examples, every request validated against the v9 schema, the spec's
sample message, signatures verified independently with libxml2 exclusive C14N, CSR checked by openssl, response
parsing of the spec examples, closure/ledger rules, and an end-to-end run (in-memory database + fake NTAK endpoint
that checks signature and schema) through queueing, sending, verification, correction, retry and blocking.
