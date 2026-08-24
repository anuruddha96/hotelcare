# Honest sync feedback, admin announcements, and smarter payments

Three separate improvements: how the Revenue page behaves around its 30-minute refresh, a proper admin-controlled announcement system replacing the hardcoded downtime banner, and a richer Payments page with percentage-based Revenue Management billing.

## 1. Revenue sync: always show data, never a silent wait

Behaviour when the page opens and the stored data is older than 30 minutes:

- Cached numbers paint immediately (as today), with a clear status line: "Data from 13:59 — updating in the background…" plus a thin progress bar.
- The background refresh is started automatically; when it lands, the numbers swap in and a short toast confirms "Updated just now — figures are current."
- If the refresh fails, the line becomes "Showing data from 13:59 — the last update didn't complete" with a retry link. No blank screen, ever.

Behaviour of the "Sync now" button, three cases:

1. **Data is fresh (under 30 minutes)** — a confirmation dialog: "Your data is already up to date as of 8 minutes ago. Refreshing pulls everything from Previo again and takes about a minute." with "Keep current data" / "Refresh anyway".
2. **A sync is already running** (yours or another user's) — the button reads "Updating…" and is disabled; tapping the label shows "An update is already running — it started 20 seconds ago and this page will update by itself. No second request is needed."
3. **Data is stale** — refreshes straight away with the existing progress card.

The button also shows a live "started X ago" hint so nobody wonders whether their click registered.

## 2. Admin announcements (replaces the hardcoded downtime banner)

New admin screen: **Admin → Announcements**.

- Create an announcement with a title, message (multi-line), tone (info / warning / critical), optional start and end time, and a "pin until dismissed" flag.
- Target by organization (one, several, or all) plus roles (e.g. all managers, or everyone).
- Sender is always shown as **Hotel Care System**.
- Admins can edit, unpublish, or delete an announcement; edits update it live for everyone.

What users see:

- A calm dismissible banner at the top of the app, styled by tone. Dismissal is per user and remembered.
- The same announcement also lands in the notification panel in the header, so a dismissed message can be re-read later; read/dismissed state is tracked per user.
- The existing automatic outage banner stays (it detects real gateway failures), but the manual downtime text moves into this system.

## 3. Payments: clearer pricing and % based Revenue Management

Admin side (Admin → Billing):

- Per organization, choose the Revenue Management pricing mode: **per room per month** or **percentage of realised room revenue**.
- Percentage mode takes a rate (e.g. 1.00%), an optional monthly minimum and cap, and applies to **realised room revenue of the previous calendar month**, per hotel, taken from the revenue data already synced from Previo.
- Housekeeping / Operations stays per room per month.
- Admins see, per hotel, last month's realised revenue and the resulting fee, so the numbers can be checked before invoicing.

Top-management side (Payments page):

- A redesigned summary at the top: which modules are active per property, monthly cost, trial status, next charge date, and payment method state — all visible at a glance.
- Each property card shows rooms, per-module price, and for percentage-based Revenue Management the estimated monthly fee with the basis spelled out ("1% of last month's realised room revenue — €38,400 → €384, excl. VAT").
- A combined monthly estimate, clearly labelled VAT-excluded, split into fixed (per-room) and variable (percentage) parts.
- Invoice history: past monthly charges with amounts and links to the Stripe receipts.

Paying during the trial:

- Checkout during the trial subscribes now but sets the first charge to the trial end date, so nothing is taken early. The page states this plainly: "You'll be charged from 1 September 2026 — the rest of your trial stays free."
- After checkout, modules show as "Paid — starts after trial".

## Technical notes

Sync:
- `RevenueHotelDetail.tsx`: `runSync` gains the three-case handling; `claimRevenueSync` returning `fresh` opens the confirm dialog instead of silently returning, `already_running` surfaces start time from `revenue_sync_wait_state`. Auto background refresh on stale load plus a completion toast. No backend change needed.

Announcements:
- New tables `system_announcements` (title, body, tone, target org slugs array, target roles array, starts_at, ends_at, published, created_by) and `announcement_receipts` (user_id, announcement_id, seen_at, dismissed_at), both with GRANTs and RLS: readers see only announcements matching their organization and role; only admins/super-admins write.
- `useAnnouncements` hook, `SystemAnnouncementBanner` component mounted next to `ServiceOutageBanner`, an entry in the header notification panel, and `src/components/admin/AnnouncementsPanel.tsx` wired into `AdminTabs`.

Payments:
- `billing_settings` gains `revenue_pricing_mode` ('per_room' | 'percent_revenue'), `revenue_percent_bps`, `revenue_percent_min_cents`, `revenue_percent_cap_cents`.
- New `billing_revenue_usage` table storing, per organization/hotel/month, the realised room revenue and computed fee, produced by a new `billing-usage-rollup` edge function (monthly cron on the 1st) reading realised room-nights from the existing revenue tables.
- `billing-manage` extended: summary returns pricing mode, last-month basis and fee, invoice history from Stripe; checkout sets `subscription_data.trial_end` to the organization trial end and creates the percentage module as a metered/invoice-item subscription so the monthly rollup posts the variable amount to Stripe.
- `Billing.tsx` and `BillingSettingsPanel.tsx` rebuilt around the new summary shape; amounts stay VAT-exclusive and stored in cents.
