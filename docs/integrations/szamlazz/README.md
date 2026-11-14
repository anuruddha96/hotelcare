# Számlázz.hu guest invoicing (Számla Agent)

Guest-facing invoices (proforma / díjbekérő, final invoice, storno, payment
registration, PDF) issued from reception through the `szamlazz-invoice` edge
function. The SaaS-billing use of Számlázz.hu in `billing-manage` is separate
and unchanged.

## One-time setup (owner does this; ~5 minutes, free)

1. Register a free account at <https://www.szamlazz.hu> (use a dedicated
   test account first — do **not** switch Hotel Memories' live account).
2. On the dashboard turn on **Tesztüzem** ("Tesztüzem bekapcsolása"). This only
   works on an account with no real invoices and no NAV connection; test-mode
   invoices are free and carry a TEST watermark.
3. Settings → **Számla Agent kulcsok** → generate an Agent key.
4. Add it as a Supabase function secret named `SZAMLAZZ_AGENT_KEY`
   (Dashboard → Edge Functions → Secrets). Never paste the key in chat, code
   or the browser.
5. In the app, the invoice panel's **status** call reports `configured: true`
   once the secret is set. No redeploy needed.

Going live later = replacing the secret with the production account's Agent
key and confirming VAT defaults with the accountant. Nothing else changes.

## What the function does

`POST /functions/v1/szamlazz-invoice` with the signed-in user's JWT:

| action    | roles                 | effect |
|-----------|-----------------------|--------|
| `status`  | all PMS view roles    | configured? + a reservation's invoices |
| `prepare` | all PMS view roles    | suggested lines from the folio (no side effects) |
| `issue`   | reception & managers  | create invoice or proforma from confirmed lines |
| `storno`  | reception & managers  | reverse an issued invoice (one storno per invoice) |
| `payment` | reception & managers  | register a payment on an issued invoice |
| `pdf`     | all PMS view roles    | fetch the PDF (base64) |

Rules enforced server-side:

- The caller confirms every line (description, quantity, unit, **gross** unit
  price, VAT key); the server recomputes net/VAT/gross and rejects unknown VAT
  keys. Defaults suggested by `prepare`: accommodation **5%**, services
  **27%**, city tax (IFA) **THK** (outside VAT scope).
- Every attempt is stored in `guest_invoices` *before* the API call
  (status `pending` → `issued`/`failed`), so a crash can never lose an issued
  invoice number. One pending attempt per reservation at a time; one storno
  per invoice; invoice numbers unique per organization.
- Non-HUF invoices are sent with MNB as the exchange-rate bank.
- `invoice_issued` / `invoice_stornoed` land in `reservation_events`, so the
  rest of HotelCare (BI, audit, reception timeline) sees them.

## Test checklist (once the secret is set)

1. `status` → `configured: true`.
2. On a test reservation with folio items: `prepare` → confirm lines →
   `issue` kind `proforma`, then kind `invoice` (expect `szlahu_szamlaszam`
   back as `invoice_number`).
3. `pdf` → opens; TEST watermark visible.
4. `payment` with the gross total → Számlázz.hu marks it settled.
5. `storno` → storno number recorded, original stays listed.
6. `issue` with VAT key `31` → clean 400, nothing stored as issued.
