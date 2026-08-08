# Rate write-back to Previo + a demand-driven pricing cockpit

## 1. Why the push fails today (verified)

`revenue-push-drafts` sends every draft to a **placeholder REST endpoint** — `PREVIO_RATE_UPDATE_PATH` defaulting to `/v1/rates/update`, which is not a real Previo route. It also imports `corsHeaders` from `npm:@supabase/supabase-js@2/cors`, a subpath that does not exist in that package, so the function can fail to boot — that is the "Edge Function returned a non-2xx status code" toast.

Previo's own documentation states the split clearly:
- **XML API** — hotel data, reservations, and `getRates` (what we already read with `callPrevioXml`).
- **EQC API** — the documented channel for **sending rates and availability into Previo**.

So writing prices is not a matter of guessing an XML method: it goes through EQC (or an XML rate-write scope), and it must be enabled on the property's Previo account. Our stored credentials today are XML/REST only — there is no EQC secret for Ottofiori.

### What gets built for the push

1. Fix the boot error (local CORS headers, same as the other functions) so failures return a readable message instead of a generic non-2xx.
2. New read-only **capability probe** (`previo-rate-write-probe`) that authenticates with the hotel's existing credentials and attempts, in order, the documented rate-write calls (XML rate-write, then EQC with EQC credentials if present), reporting exactly which one the account accepts and the verbatim Previo response.
3. Rewrite the push to use the confirmed transport — a real XML/EQC request built from `prlId` (rate plan), `obkId` (room type), date range and occupancy price, matching the shape `getRates` returns — instead of the invented JSON payload. After a successful push it re-pulls `getRates` for those dates and confirms the stored price equals the pushed price ("verified in Previo" badge on the draft).
4. Add an admin field for **EQC credentials** on the PMS account (stored as a secret, never in the table) so the write path can be enabled per hotel without code changes.
5. Until the probe confirms a write scope, the review bar states plainly: pushes are blocked, drafts are safe, and it shows the exact request text to send Previo support to enable rate write.

## 2. Price by demand, not by numbers

A day is rated **High / Medium / Low** (plus optional "Event"). The rating drives the price; the user never types a number unless they want to.

- Low demand: **−2 EUR** (HUF hotels get the same value converted at the hotel's stored exchange rate, rounded to a whole number).
- Medium: hold.
- High: step up by the pickup ladder below.
- Every rating is saved with **who, when, the reason, and an optional event name**, so next year the same calendar day shows "last year: High — Sziget Festival" directly in the Rate & pickup calendar.

## 3. Pickup ladder (Ottofiori numbers, per hotel, editable)

Measured on bookings for the same stay date, using time since the last booking:

| Trigger | Action |
| --- | --- |
| 1st pickup | +11 EUR |
| 2nd pickup | +18 EUR for the whole day |
| 3rd pickup | +40 EUR |
| No booking for 3 hours | −1 EUR, repeating every 3 hours |

Hard stop: the price can never fall below the hotel's **minimum ADR (120 EUR for Ottofiori)** unless a user sets the price manually and confirms the override. Instant bookings inside a one-hour window are collapsed into one step so a burst does not multiply the increase.

The engine runs on the existing `revenue-engine-tick`/`revenue-autopilot-tick` schedule and produces **drafts with a written reason** ("2nd pickup today at 14:05 → +18"). Nothing reaches Previo until pushed, unless the hotel turns on auto-apply for the current day.

## 4. Modern group settings (replacing Previo's bulk dialog)

One panel, opened from the calendar, working on a date range plus weekday filter:

- Presets: Weekend uplift, Last-minute fill, Event week, Low season, Reset to base.
- Adjust by **demand rating**, by **percentage**, or by **fixed amount**; one- or two-step uplift for the days already flagged as pickup days.
- "Apply to pickup days only" — the system pre-selects today's identified pickup days so the revenue manager acts from one screen without hunting through pickups.
- Live preview of every affected cell with the before/after price and the resulting ADR, then Save as drafts → Review & push.

## 5. Surge explanation, events and yearly patterns

- When a day shows a sudden surge, an OpenAI call (using your `OPENAI_API_KEY`, not the Lovable gateway) proposes the probable reason and any known event, which the user confirms or edits.
- Confirmed events are stored in the events calendar and rendered as a marker row in the **Rate & pickup calendar** and on the pickup chart, with last year's same-week events shown as a faint reference.
- A new **Patterns** view charts, across all stored years: pickup by weekday and lead time, demand ratings vs realised ADR/occupancy, event weeks vs normal weeks, and how often a rating was later proved right.

## 6. Grid UI fix

The ADR and RevPAR rows use a translucent `bg-primary/10` on the frozen left column, so scrolled price cells bleed through the label — that is the overlap you circled. Those frozen cells get an opaque surface (with the accent kept as a left border), and the row is raised above the scrolling cells so the labels always read cleanly.

## Technical notes

- `revenue-push-drafts`: local `corsHeaders`, real transport, per-draft verbatim Previo error, post-push verification via `getRates`.
- New `previo-rate-write-probe` (read-only, admin-gated) and an EQC credential slot on `pms_accounts` / `pms_configurations`.
- New tables: `revenue_demand_ratings` (hotel, date, rating, reason, event, user, created_at), `revenue_pickup_actions` (audit of every ladder step), plus reuse of `hotel_events` / `surge_events`; extend `hotel_revenue_settings` with `min_adr`, pickup ladder amounts and the idle-decay rule.
- `src/lib/revenuePricing.ts` gains the demand + pickup-ladder rules and the min-ADR clamp; all money flows through `revenueCurrency.ts` so HUF hotels see converted whole numbers.
- SLNT and other tenants inherit defaults but keep their own ladder values; Ottofiori's numbers are seeded exactly as above.

## Order of work

1. Fix the push function error and ship the capability probe — report exactly what Previo allows.
2. Grid UI fix.
3. Demand ratings + pickup ladder engine with min-ADR clamp and drafts with reasons.
4. Modern group-settings panel.
5. Events calendar, OpenAI surge reasons, and the yearly Patterns charts.
