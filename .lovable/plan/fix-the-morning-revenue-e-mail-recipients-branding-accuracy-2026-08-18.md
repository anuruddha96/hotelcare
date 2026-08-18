# Fix the morning revenue e-mail: recipients, branding, accuracy

## What went wrong

Confirmed from the code and the database:

- **It was sent to everyone.** On the scheduled run the function ignores the configured recipient list and adds *every* admin, manager and top-management profile in the whole organisation (`rdhotels`) — that is the 18 addresses in your screenshot, including staff `.local` accounts. Only the manual "Send me one now" path respects the configured list.
- **Everyone saw everyone.** All addresses go into a single `To`, so each recipient sees the full list.
- **Hotel name missing.** The settings row stores `hotel_id = "ottofiori"` (a slug), but the function looks it up in `hotels.id`, which holds UUIDs. The lookup fails and it falls back to the literal text "Your hotel".
- **Dark, unbranded look.** The header uses a near-black to blue gradient, and the body inherits the mail client's dark mode.
- **Data freshness is not stated or guaranteed.** The digest reads whatever snapshots exist; it never checks how old they are and never says so.

## What will change

### 1. Send only to the configured people
- The scheduled path uses exactly the same recipient list as the manual test: the addresses saved in **Revenue → Morning e-mail**. No automatic role-based expansion.
- If the list is empty, the digest is skipped for that hotel and recorded as "no recipients configured" instead of falling back to staff.
- Internal `@rdhotels.local` placeholder addresses are never used.
- Each recipient gets their own message (individual sends), so nobody sees the other addresses.

### 2. Correct hotel name
- Resolve the hotel by slug **and** UUID (the same mapping the rest of the app uses), so the header reads "Hotel Ottofiori". If the name still cannot be resolved, skip the send and report it rather than mailing "Your hotel".

### 3. White-and-blue, friendly design
- White page background, white card, light blue accent header with the Hotel Care wordmark, hotel name and date.
- Metric tiles: white with a light blue border, blue numbers, grey labels — readable in both light and dark mail clients (explicit background and text colours, `color-scheme: light`).
- Softer section headings, more spacing, a single-column layout that reads well on a phone.
- Plain-text alternative included so the message is not flagged as spam-like.

### 4. Accurate, as-of-send-time data
- Before building each digest, refresh the hotel's Previo revenue data (the same sync the app uses), then read the figures — so the e-mail matches what the app shows at that moment.
- Cross-check the numbers against a single source: occupancy, ADR, RevPAR and next-14-night figures all come from the latest capture per stay date, and pickup counts distinct reservations over the last 24 hours (same rule as the Rate & pickup calendar).
- Add a footer line: "Figures as of HH:MM Budapest time, data last synced HH:MM." If the sync is stale or fails, the e-mail says so rather than printing silently wrong numbers.

### 5. Confidentiality note
- Footer states the message contains confidential commercial data and names who configured the recipients.

## Technical notes

- `supabase/functions/revenue-morning-digest/index.ts`
  - Recipient resolution rewritten: `settings.recipients` only (plus the requester on a forced test); drop the `profiles` role query.
  - Loop recipients and call `sendEmail` per address.
  - Hotel name: try `hotels.id = hotel_id`, then `hotels` by normalised name/slug via the existing `get_hotel_name_from_id` helper; error out if unresolved.
  - Call `previo-revenue-sync` for the hotel (best-effort, short timeout) before `buildDigest`, and read `revenue_sync_state` to report freshness.
  - `renderHtml` restyled to the white/blue palette; add a matching `text` body.
- `src/components/revenue/MorningDigestPanel.tsx`: reword the helper text — managers are no longer auto-included; only the listed addresses receive it.
- No database schema change required.

## Verification

- Query the digest settings and confirm the resolved recipient list is exactly the configured one.
- Send a forced digest for Ottofiori and confirm: correct hotel name in the subject and header, one recipient per message, white/blue rendering, and figures matching the Revenue page at that minute.
