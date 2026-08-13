# SLNT Previo access, honest revenue figures, and a 30-minute shared sync

Four separate problems, fixed in one pass.

## 1. One Previo key, many property IDs

Confirmed in the database: both SLNT accounts (`pms_hotel_id` 782407 and 783103, org `slnt`) exist and synced this morning, but their `credentials_secret_name` is **empty**. Several code paths (rate push, revenue pull, rate-plan sync) skip an account when that field is null, which is why SLNT can read some data but cannot push rates.

Fix: treat the Previo credential as **one shared key for all of HotelCare**, with the property ID selecting the hotel.

- Point both SLNT accounts at the existing shared Previo credential secret.
- Add a single fallback in the Previo helper: when an account or config has no credential name, use the shared key instead of skipping the account.
- Keep the property ID (`pms_hotel_id`) as the only per-property input, exactly as Previo intends.
- After wiring, run the rate-plan sync for both SLNT property IDs so the price list can publish (today it is blocked because SLNT has zero rate-plan mappings).

## 2. Is "Revenue on the books" correct?

Checked the live data for SLNT, August 2026. The database holds 1,155 confirmed/on-the-books room-nights totalling 29.5m Ft, split across two booking statuses (958 rows / 25.1m Ft in one status, 197 rows / 4.4m Ft in the other). The screen shows 884 nights and 25.87m Ft, so a slice of nights is being dropped by the status filter used in the month header. The header also reports 63 units of inventory while SLNT has 61.

Fix:
- Settle one definition of "on the books" (confirmed + guaranteed, excluding cancelled/no-show/option) and apply that same filter everywhere: month tiles, occupancy, ADR, RevPAR, pickup and the horizon chart.
- Correct SLNT inventory to the real unit count so occupancy, RevPAR and "rooms left to sell" line up.
- Extend the info tooltip to state exactly which statuses are counted and the nights/total behind the figure, so any number can be checked against Previo.

## 3. ADR target shows €0 for SLNT

The sales goals are stored in the browser only, as plain numbers assumed to be euros. For a HUF property the same "120" is printed as "80 Ft", and an empty stored value reads as €0 — that is what the screenshot shows.

Fix:
- Store the goals per property in the database in the property's base currency (HUF for SLNT, EUR for the RD hotels), so every manager sees the same target.
- Seed a sensible starting target from the property's trailing 30-day ADR instead of a hardcoded 120.
- Print goals through the same currency formatter as the rest of Revenue, so the Ft/€ toggle converts the target too, and remove the impossible "23322% of goal" style readouts caused by a zero target.

## 4. Shared 30-minute freshness, per property

Today every user login and every page can trigger its own Previo call, and "Today's Sales & ADR Goal" shows "Not synced yet" even right after a PMS refresh.

New behaviour, scoped strictly to a single property (venue) — never an organisation-wide or cross-organisation effect:

- Each property keeps one authoritative "last synced" timestamp, written by whoever last refreshed it.
- On login or when opening a property: if that property's last sync is **older than 30 minutes**, the app syncs it automatically in the background. If it is fresher, no Previo call is made — the user reads the already-current data.
- So if Richie refreshes SLNT, Anu opening the same property within 30 minutes gets no new Previo call; and a refresh on any SLNT property changes nothing for RD Hotels or Ottofiori, and vice versa.
- The "Not synced yet" pill becomes a live freshness chip on the Today's Sales card: "Synced 11:24 · 8 min ago", amber when older than 30 minutes, with a manual refresh always available.
- The Today's Sales card, the month tiles and the rate grid all re-read after a PMS refresh, so one refresh updates the whole page.

## Technical notes

- `pms_accounts.credentials_secret_name` set for both SLNT rows; shared-secret fallback added in the Previo credential loader used by `revenue-push-drafts`, `previo-pull-revenue`, `previo-push-rates`, `slnt-pms-sync` and the probes.
- Freshness gate lives in `LiveSyncContext`, keyed by hotel id and backed by the per-property `last_sync_at` (from `pms_accounts` / `pms_sync_history`) rather than per-browser state, with a short client cache to avoid duplicate triggers when several tabs open at once.
- Goals move from `localStorage` (`hc.revenue.salesGoals.*`) to a per-hotel row in the revenue settings table, with a one-time read of existing local values as the initial import.
- Status filtering centralised in `revenueAnalytics` so month header, charts and pickup all share it.
